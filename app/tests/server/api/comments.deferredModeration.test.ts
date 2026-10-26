import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { Table } from "drizzle-orm";
import { FORUM_MIN_LEVEL, MESSAGING_MIN_LEVEL } from "@/drizzle/constants";
import { conversationComment, forumPost, userNindo } from "@/drizzle/schema";
import * as moderation from "@/libs/moderation/defer";
import * as pusher from "@/libs/pusher";
import { commentsRouter } from "@/routers/comments";
import { forumRouter } from "@/routers/forum";
import { profileRouter, updateNindo } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { callerForDatabase } from "../../setup/testDatabase";

const user = {
  userId: "poster", username: "Poster", role: "USER", isBanned: false, isSilenced: false,
  level: Math.max(FORUM_MIN_LEVEL, MESSAGING_MIN_LEVEL),
};
const comment = {
  id: "post", userId: user.userId, threadId: "thread", conversationId: "conversation",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};
const input = { object_id: "post", comment: "A normal game conversation", quoteIds: null, senderId: null };
const trigger = vi.fn();
const defer = vi.fn();

const makeClient = (write: (table: Table) => Promise<unknown> = async () => ({ rowsAffected: 1 }), isPublic = true) => ({
  query: {
    userData: { findFirst: async () => user },
    forumThread: { findFirst: async () => ({ id: "thread" }) },
    forumBoard: { findFirst: async () => ({ id: "board", name: "Discussion" }) },
    forumPost: { findFirst: async () => comment },
    conversationComment: { findFirst: async () => comment },
    conversation: { findFirst: async () => ({ id: "conversation", isPublic, isEnabled: true, isStaffAvailable: false, users: [{ userId: user.userId }] }) },
    parentalControl: { findMany: async () => [] },
    userNindo: { findFirst: async () => ({ userId: user.userId }) },
  },
  insert: (table: Table) => ({ values: () => write(table) }),
  update: (table: Table) => ({ set: () => ({ where: () => write(table) }) }),
  selectDistinct: () => ({ from: () => ({ innerJoin: () => ({ where: async () => [] }) }) }),
}) as unknown as DrizzleClient;

const cases = [
  { name: "public conversation creation", table: conversationComment, relationType: "comment", run: (db: DrizzleClient, text = input.comment) => callerForDatabase(commentsRouter, user.userId, db).createConversationComment({ ...input, comment: text }) },
  { name: "conversation editing", table: conversationComment, relationType: "comment", run: (db: DrizzleClient, text = input.comment) => callerForDatabase(commentsRouter, user.userId, db).editConversationComment({ ...input, comment: text }) },
  { name: "forum comment creation", table: forumPost, relationType: "forumPost", run: (db: DrizzleClient, text = input.comment) => callerForDatabase(commentsRouter, user.userId, db).createForumComment({ ...input, comment: text }) },
  { name: "forum comment editing", table: forumPost, relationType: "forumPost", run: (db: DrizzleClient, text = input.comment) => callerForDatabase(commentsRouter, user.userId, db).editForumComment({ ...input, comment: text }) },
  { name: "forum thread creation", table: forumPost, relationType: "forumPost", run: (db: DrizzleClient, text = input.comment) => callerForDatabase(forumRouter, user.userId, db).createThread({ board_id: "board", title: "Game discussion", content: text, image: null, senderId: null }) },
  { name: "profile nindo", table: userNindo, relationType: "userNindo", run: (db: DrizzleClient, text = input.comment) => callerForDatabase(profileRouter, user.userId, db).updateNindo({ userId: user.userId, content: text }) },
];

beforeEach(() => {
  defer.mockReset();
  trigger.mockReset().mockResolvedValue(undefined);
  vi.spyOn(moderation, "deferModeration").mockImplementation(defer);
  vi.spyOn(pusher, "getServerPusher").mockReturnValue({ trigger } as unknown as ReturnType<typeof pusher.getServerPusher>);
  // Keep rate limiting active, but prevent external HTTP in caller tests.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    if (typeof init?.body !== "string" || !init.body.includes("trpc-ratelimit")) throw new Error("Unexpected HTTP request");
    const commands = JSON.parse(init.body) as unknown[];
    const resultFor = (command: unknown[]) => ({ result: command[0] === "evalsha" || command[0] === "eval" ? [59, 60] : 1 });
    return Response.json(Array.isArray(commands[0]) ? commands.map((c) => resultFor(c as unknown[])) : resultFor(commands));
  });
});
afterEach(() => vi.restoreAllMocks());

describe("posting moderation scheduling", () => {
  it.each(cases)("returns from $name after storage without waiting for moderation", async ({ run, table, relationType }) => {
    let saved = false;
    let release!: () => void;
    let started!: () => void;
    const writing = new Promise<void>((resolve) => { started = resolve; });
    const stored = new Promise<void>((resolve) => { release = resolve; });
    const db = makeClient(async (target) => {
      if (target === table) { started(); await stored; saved = true; }
      return { rowsAffected: 1 };
    });
    defer.mockImplementation(() => { expect(saved).toBe(true); });
    const request = run(db);
    await writing;
    expect(defer).not.toHaveBeenCalled();
    release();
    expect((await request).success).toBe(true);
    expect(defer).toHaveBeenCalledTimes(1);
    expect(defer.mock.calls[0]?.[1]).toMatchObject({ content: input.comment, userId: user.userId, relationType });
  });

  it.each(cases)("does not schedule a scan when the $name content write fails", async ({ run, table }) => {
    const db = makeClient(async (target) => {
      if (target === table) throw new Error("Content write failed");
      return { rowsAffected: 1 };
    });
    await expect(run(db)).rejects.toThrow("Content write failed");
    expect(defer).not.toHaveBeenCalled();
  });

  it.each(cases.slice(0, 5))("keeps the profanity gate before the $name write", async ({ run }) => {
    const writes = vi.fn().mockResolvedValue({ rowsAffected: 1 });
    const db = makeClient(writes);
    const result = await run(db, "This is shit");
    expect(result.success).toBe(false);
    expect(writes).not.toHaveBeenCalled();
    expect(defer).not.toHaveBeenCalled();
  });

  it("broadcasts a public message before its moderation callback runs", async () => {
    expect((await cases[0]!.run(makeClient())).success).toBe(true);
    expect(trigger).toHaveBeenCalledWith("conversation", "event", expect.objectContaining({ message: "new" }));
    expect(defer).toHaveBeenCalledTimes(1);
  });

  it.each([cases[0]!, cases[2]!, cases[4]!])("still schedules a scan for saved $name content when a counter write fails", async ({ run, table }) => {
    const db = makeClient(async (target) => {
      if (target !== table) throw new Error("Counter write failed");
      return { rowsAffected: 1 };
    });
    await expect(run(db)).rejects.toThrow("Counter write failed");
    expect(defer).toHaveBeenCalledTimes(1);
  });

  it("keeps new private messages unscanned and private edits scanned", async () => {
    const db = makeClient(undefined, false);
    expect((await cases[0]!.run(db)).success).toBe(true);
    expect(defer).not.toHaveBeenCalled();
    expect((await cases[1]!.run(db)).success).toBe(true);
    expect(defer.mock.calls[0]?.[1]).toMatchObject({ relationType: "privateMessage", createdAt: comment.createdAt });
  });

  it.each(["clanOrder", "anbuOrder", "kageOrder"] as const)("defers shared %s Nindo updates", async (type) => {
    expect((await updateNindo(makeClient(), user.userId, input.comment, type)).success).toBe(true);
    expect(defer.mock.calls[0]?.[1]).toMatchObject({ relationType: type, relationId: user.userId });
  });
});
