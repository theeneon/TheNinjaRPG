import * as socials from "@/libs/socials";
import { reportsRouter } from "@/routers/reports";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { forumAlert, forumAudit, forumBoard, forumGrant, forumPost, forumReaction, forumRead, forumRestriction, forumRevision, forumSection, forumThread, forumWatch, userData, userReport, poll, pollOption, userPollVote, userUpload, forumCase } from "@/drizzle/schema";
import { fetchForumThreadPage, getForumContext, getInfiniteThreads } from "@/libs/forum";
import * as moderation from "@/libs/moderation/defer";
import { commentsRouter } from "@/routers/comments";
import { forumRouter } from "@/routers/forum";
import { listForumAudit } from "@/queries/forum";
import type { DrizzleClient } from "@/server/db";
import { insertUsers } from "../../../setup/factories";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

const playerId = "forum-player"; const adminId = "forum-admin"; const moderatorId = "forum-scoped-moderator";
const topicInput = (board_id = "general") => ({ board_id, title: "Learning the shinobi arts", content: "<p>A useful game discussion.</p>", senderId: null, image: null });
const commentInput = (object_id: string, comment = "A useful answer to this question.") => ({ object_id, comment, senderId: null, quoteIds: null });
const client = async (id = playerId, database?: DrizzleClient) => callerForDatabase(forumRouter, id, database ?? await getTestDatabase());
const comments = async (id = playerId, database?: DrizzleClient) => callerForDatabase(commentsRouter, id, database ?? await getTestDatabase());
const create = async (boardId = "general", id = playerId) => {
  const result = await (await client(id)).createThread(topicInput(boardId));
  expect(result.success).toBe(true); if (!result.threadId) throw new Error("Expected a created topic"); return result.threadId;
};

describeWithDatabase("forum authorization, administration and discussion lifecycle", () => {
  beforeEach(async () => {
    const db = await getTestDatabase();
    await resetTables(userPollVote, pollOption, poll, userUpload, forumCase, userReport, forumAlert, forumAudit, forumGrant, forumReaction, forumRead, forumRestriction, forumRevision, forumWatch, forumPost, forumThread, forumBoard, forumSection, userData);
    await insertUsers([{ userId: playerId, username: "ForumPlayer", level: 50 }, { userId: adminId, username: "ForumAdmin", level: 50, role: "MODERATOR-ADMIN" }, { userId: moderatorId, username: "ForumModerator", level: 50 }]);
    await db.insert(forumSection).values([{ id: "public", name: "Community", summary: "", policy: {} }, { id: "private", name: "Staff", summary: "", policy: { view: "STAFF", read: "STAFF", create: "STAFF" } }]);
    await db.insert(forumBoard).values([{ id: "general", name: "General discussion", summary: "", sectionId: "public" }, { id: "other", name: "Other board", summary: "", sectionId: "public" }, { id: "private-board", name: "Private discussions", summary: "", sectionId: "private" }, { id: "news", name: "News", summary: "", sectionId: "public", policy: { create: "STAFF" } }]);
    await db.insert(forumGrant).values({ id: "scoped", userId: moderatorId, scope: "BOARD", scopeId: "general", permissions: ["moderate", "approve"], denies: [] });
    vi.spyOn(moderation, "deferModeration").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (typeof init?.body !== "string" || !init.body.includes("trpc-ratelimit")) throw new Error("Unexpected external request in forum tests");
      const commands = JSON.parse(init.body) as unknown[];
      const resultFor = (command: unknown[]) => ({ result: command[0] === "evalsha" || command[0] === "eval" ? [59, 60] : 1 });
      return Response.json(Array.isArray(commands[0]) ? commands.map(c => resultFor(c as unknown[])) : resultFor(commands));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("rejects banned, silenced and low-level posting before any topic, post or counter write", async () => {
    const db = await getTestDatabase();
    for (const values of [{ isBanned: true }, { isBanned: false, isSilenced: true }, { isSilenced: false, level: 1 }]) {
      await db.update(userData).set(values).where(eq(userData.userId, playerId));
      expect((await (await client()).createThread(topicInput())).success).toBe(false);
    }
    expect(await db.query.forumThread.findMany()).toHaveLength(0); expect(await db.query.forumPost.findMany()).toHaveLength(0);
    expect((await db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "general") }))?.nThreads).toBe(0);
  });
  it("sanitizes opening posts and edits, records revisions, and rejects player News creation", async () => {
    const result = await (await client()).createThread({ ...topicInput(), content: '<p>Useful strategy</p><script>alert(1)</script><img src="x" onerror="alert(1)">' });
    expect(result.success).toBe(true); const db = await getTestDatabase(); const post = (await db.query.forumPost.findMany())[0]!;
    expect(post.content).not.toContain("<script"); expect(post.content).not.toContain("onerror");
    expect((await (await comments()).editForumComment(commentInput(post.id, "<p>Updated strategy</p><script>bad()</script>"))).success).toBe(true);
    expect(await db.query.forumRevision.findMany()).toHaveLength(1);
    expect((await db.query.forumPost.findFirst())?.content).not.toContain("<script");
    expect((await (await client()).createThread(topicInput("news"))).success).toBe(false);
  });
  it("enforces topic locks and archived sections on direct reply calls", async () => {
    const id = await create(); await (await client(moderatorId)).lockThread({ thread_id: id, status: true });
    expect((await (await comments()).createForumComment(commentInput(id))).success).toBe(false);
    await (await client(moderatorId)).lockThread({ thread_id: id, status: false });
    const db = await getTestDatabase(); await db.update(forumSection).set({ archived: true }).where(eq(forumSection.id, "public"));
    expect((await (await comments()).createForumComment(commentInput(id))).success).toBe(false);
    expect(await db.query.forumPost.findMany()).toHaveLength(1);
  });
  it("rolls topic and opening post back if a counter statement fails", async () => {
    const db = await getTestDatabase(); const failing = new Proxy(db, { get(target, key, receiver) {
      if (key === "transaction") return (work: (tx: unknown) => unknown) => target.transaction(tx => work(new Proxy(tx, { get(transaction, property, txReceiver) { if (property === "update") return (table: unknown) => { if (table === forumBoard) throw new Error("Counter write failed"); return transaction.update(table as never); }; return Reflect.get(transaction, property, txReceiver); } })) as Promise<unknown>);
      return Reflect.get(target, key, receiver);
    } });
    await expect((await client(playerId, failing)).createThread(topicInput())).rejects.toThrow("Counter write failed");
    expect(await db.query.forumThread.findMany()).toHaveLength(0); expect(await db.query.forumPost.findMany()).toHaveLength(0);
    expect(moderation.deferModeration).not.toHaveBeenCalled();
  });
  it("keeps counts and latest activity correct with concurrent replies and recoverable removal", async () => {
    const id = await create(); const api = await comments();
    await Promise.all(Array.from({ length: 4 }, (_, index) => api.createForumComment(commentInput(id, `Parallel reply number ${index}`))));
    const db = await getTestDatabase(); const thread = await db.query.forumThread.findFirst(); const board = await db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "general") });
    expect(thread?.nPosts).toBe(5); expect(board?.nPosts).toBe(5); expect(board?.nThreads).toBe(1);
    const post = (await db.query.forumPost.findMany())[0]!;
    expect((await api.deleteForumComment({ id: post.id })).success).toBe(true);
    expect((await db.query.forumThread.findFirst())?.nPosts).toBe(4);
    expect((await (await client(moderatorId)).moderatePost({ postId: post.id, action: "RESTORE", reason: "Restore review evidence" })).success).toBe(true);
    expect((await db.query.forumThread.findFirst())?.nPosts).toBe(5);
    expect((await db.query.forumPost.findFirst({ where: eq(forumPost.id, post.id) }))?.deletedAt).toBeNull();
  });
  it("keeps private content out of listings, search, direct posts and server-rendered guest payloads", async () => {
    const id = await create("private-board", adminId); const db = await getTestDatabase(); const post = (await db.query.forumPost.findMany())[0]!;
    expect((await (await client()).getAll()).some(b => b.id === "private-board")).toBe(false);
    expect((await (await client()).getThreads({ query: "shinobi", limit: 20 })).threads).toHaveLength(0);
    expect((await (await comments()).getForumComments({ thread_id: id, limit: 20 })).thread).toBeNull();
    expect(await (await client()).resolvePost({ postId: post.id })).toBeNull();
    expect((await fetchForumThreadPage(db, { thread_id: id, limit: 20 })).thread).toBeNull();
    expect((await getInfiniteThreads({ client: db, boardId: "private-board", limit: 20 })).board).toBeNull();
    expect((await getForumContext(db)).boards.find(b => b.id === "private-board")?.publicRead).toBe(false);
  });
  it("fails closed for boards missing their section", async () => {
    const db = await getTestDatabase(); await db.delete(forumSection).where(eq(forumSection.id, "public"));
    expect((await (await client()).getAll()).some(b => b.id === "general")).toBe(false);
  });
  it("limits scoped moderators to content in their boards and checks stored restriction scope", async () => {
    const otherId = await create("other"); const api = await client(moderatorId);
    expect((await api.lockThread({ thread_id: otherId, status: true })).success).toBe(false);
    const id = await create(); expect((await api.moderateThreads({ ids: [id], action: "UPDATE", boardId: "other", reason: "Try cross-scope move" })).success).toBe(false);
    const db = await getTestDatabase(); await db.insert(forumRestriction).values({ id: "global-restriction", userId: playerId, boardId: null, expiresAt: new Date(Date.now() + 60000), reason: "Global restriction" });
    expect((await api.restrict({ id: "global-restriction", userId: playerId, boardId: "general", expiresAt: new Date(Date.now() + 60000), reason: "Attempt scope replacement", remove: true })).success).toBe(false);
    expect(await db.query.forumRestriction.findMany()).toHaveLength(1);
    expect((await api.saveSection({ name: "Unauthorized section", summary: "", position: 0, archived: false, policy: {}, reason: "Attempt structural edit" })).success).toBe(false);
  });
  it("does not replace board identifiers on a case-insensitive duplicate name", async () => {
    const api = await client(adminId); const result = await api.saveBoard({ name: "GENERAL DISCUSSION", summary: "", sectionId: "public", parentId: null, position: 0, archived: false, rules: "", policy: {}, slowModeSeconds: 0, requireApproval: false, reason: "Create duplicate board" });
    expect(result.success).toBe(false); const db = await getTestDatabase(); expect((await db.query.forumBoard.findFirst({ where: eq(forumBoard.name, "General discussion") }))?.id).toBe("general");
  });
  it("holds topics and replies for approval and supports slow mode", async () => {
    const db = await getTestDatabase(); await db.update(forumBoard).set({ requireApproval: true }).where(eq(forumBoard.id, "general"));
    const result = await (await client()).createThread(topicInput()); expect(result.success).toBe(true); expect(result.threadId).toBeUndefined();
    const thread = (await db.query.forumThread.findMany())[0]!; expect((await (await client()).getThreads({ boardId: "general", limit: 20 })).threads).toHaveLength(0);
    expect((await (await client(moderatorId)).moderateThreads({ ids: [thread.id], action: "APPROVE", reason: "Reviewed opening post" })).success).toBe(true);
    await db.update(forumBoard).set({ slowModeSeconds: 3600, requireApproval: false }).where(eq(forumBoard.id, "general"));
    expect((await (await comments()).createForumComment(commentInput(thread.id))).success).toBe(false);
    expect((await db.query.forumThread.findFirst())?.nPosts).toBe(1);
  });
  it("tracks unread state, stable post positions, reactions, accepted answers and watches", async () => {
    const api = await client(); const result = await api.createThread({ ...topicInput(), kind: "QUESTION", tags: ["strategy"] }); const id = result.threadId!;
    await (await client(moderatorId)).watch({ scope: "THREAD", scopeId: id, active: true, push: false });
    expect((await (await comments()).createForumComment(commentInput(id))).success).toBe(true);
    const db = await getTestDatabase(); const posts = await db.query.forumPost.findMany({ orderBy: [forumPost.createdAt, forumPost.id] }); const last = posts.at(-1)!;
    expect((await (await client(moderatorId)).alerts())).toHaveLength(1);
    expect((await api.getThreads({ view: "unread", limit: 20 })).threads).toHaveLength(1);
    expect((await api.resolvePost({ postId: last.id }))?.threadId).toBe(id);
    await api.markRead({ postId: last.id }); expect((await api.getThreads({ view: "unread", limit: 20 })).threads).toHaveLength(0);
    await api.markRead({ postId: posts[0]!.id }); expect((await db.query.forumRead.findFirst())?.postId).toBe(last.id);
    expect((await api.react({ postId: last.id, reaction: "helpful", active: true })).success).toBe(true); await api.react({ postId: last.id, reaction: "helpful", active: true }); expect(await db.query.forumReaction.findMany()).toHaveLength(1);
    expect((await api.acceptAnswer({ threadId: id, postId: last.id })).success).toBe(true);
    await (await comments()).deleteForumComment({ id: last.id }); expect((await db.query.forumThread.findFirst())?.acceptedPostId).toBeNull();
    expect((await api.acceptAnswer({ threadId: id, postId: last.id })).success).toBe(false);
  });
  it("moves, copies and splits topics with intact counters and direct post links", async () => {
    const id = await create(); await (await comments()).createForumComment(commentInput(id)); const api = await client(adminId);
    const copy = await api.restructureTopic({ threadId: id, action: "COPY", boardId: "other", title: "Copied guide discussion", reason: "Share a reviewed guide", postIds: [] }); expect(copy.success).toBe(true);
    const db = await getTestDatabase(); const posts = await db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) });
    const split = await api.restructureTopic({ threadId: id, action: "SPLIT", boardId: "other", title: "Follow-up guide discussion", reason: "Keep replies on topic", postIds: [posts[1]!.id] }); expect(split.success).toBe(true);
    expect((await api.resolvePost({ postId: posts[1]!.id }))?.threadId).toBe(split.threadId);
    expect((await db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "other") }))?.nPosts).toBe(3);
    expect((await api.restructureTopic({ threadId: id, action: "MERGE", targetThreadId: copy.threadId, reason: "Merge duplicate guide", postIds: [] })).success).toBe(true);
    expect((await db.query.forumThread.findFirst({ where: eq(forumThread.id, id) }))?.deletedAt).toBeInstanceOf(Date);
  });
  it.each([1000, 2500, 3000, 4000])("keeps merged contributions discoverable at timestamp %d", async (sourceTime) => {
    const db = await getTestDatabase(); const source = await create(); const target = await create(); const other = await create("other");
    const sourcePost = (await db.query.forumPost.findMany({ where: eq(forumPost.threadId, source) }))[0]!;
    const targetPost = (await db.query.forumPost.findMany({ where: eq(forumPost.threadId, target) }))[0]!;
    await db.update(forumPost).set({ id: "m-merge-source", createdAt: new Date(sourceTime) }).where(eq(forumPost.id, sourcePost.id));
    await db.update(forumPost).set({ createdAt: new Date(2000) }).where(eq(forumPost.id, targetPost.id));
    await db.insert(forumPost).values([
      { id: "z-target-latest", threadId: target, userId: playerId, authorId: playerId, content: "Destination reply already read", createdAt: new Date(3000) },
      { id: "merge-removed", threadId: source, userId: playerId, authorId: playerId, content: "Removed source post", createdAt: new Date(500), deletedAt: new Date() },
      { id: "merge-pending", threadId: source, userId: playerId, authorId: playerId, content: "Pending source post", createdAt: new Date(700), isApproved: false },
    ]);
    const reader = await client(); const behind = await client(moderatorId); const admin = await client(adminId);
    await admin.repairCounters({ boardId: "general" });
    await reader.markRead({ postId: "z-target-latest" }); await behind.markRead({ postId: targetPost.id });
    const otherPost = (await db.query.forumPost.findMany({ where: eq(forumPost.threadId, other) }))[0]!;
    await reader.markRead({ postId: otherPost.id }); const otherRead = (await reader.personal()).reads.find(r => r.threadId === other);
    const merge = () => admin.restructureTopic({ threadId: source, action: "MERGE", targetThreadId: target, postIds: [], reason: "Combine related discussions" });
    expect((await merge()).success).toBe(true);
    const resumed = (await reader.getThreads({ boardId: "general", view: "unread", limit: 20 })).threads.find(t => t.id === target)!;
    expect(resumed).toMatchObject({ nPosts: 3, unread: true, resumePostId: sourceTime < 2000 ? null : sourceTime <= 3000 ? targetPost.id : "z-target-latest" });
    expect((await behind.personal()).reads.find(r => r.threadId === target)?.postId).toBe(sourceTime < 2000 ? undefined : targetPost.id);
    expect((await reader.personal()).reads.find(r => r.threadId === other)).toEqual(otherRead);
    expect((await reader.resolvePost({ postId: "m-merge-source" }))?.threadId).toBe(target);
    expect((await reader.getThreads({ boardId: "general", limit: 20 })).threads.some(t => t.id === source)).toBe(false);
    if (resumed.resumePostId) expect((await reader.resolvePost({ postId: resumed.resumePostId }))?.threadId).toBe(target);
    await reader.markRead({ postId: sourceTime > 3000 ? "m-merge-source" : "z-target-latest" });
    const reads = (await reader.personal()).reads;
    expect((await merge()).success).toBe(false);
    expect((await reader.personal()).reads).toEqual(reads);
    expect((await reader.getThreads({ boardId: "general", view: "unread", limit: 20 })).threads.some(t => t.id === target)).toBe(false);
  });
  it.each(["staff", "author"])("preserves usable reading positions after %s removes a saved cursor", async (path) => {
    const db = await getTestDatabase(); const id = await create(); const other = await create("other");
    const opening = (await db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) }))[0]!;
    await db.update(forumPost).set({ createdAt: new Date(1000) }).where(eq(forumPost.id, opening.id));
    await db.insert(forumPost).values(Array.from({ length: 44 }, (_, i) => ({
      id: `cursor-${String(i + 2).padStart(2, "0")}`, threadId: id, userId: playerId, authorId: playerId, content: `Discussion chapter ${i + 2}`,
      createdAt: new Date((i + 2 === 28 || i + 2 === 29 ? 30 : i + 2) * 1000), isApproved: i + 2 !== 29,
    })));
    await db.update(forumPost).set({ deletedAt: new Date() }).where(eq(forumPost.id, "cursor-27"));
    const reader = await client(); const admin = await client(adminId); const behind = await client(moderatorId);
    await admin.repairCounters({ boardId: "general" });
    await reader.markRead({ postId: "cursor-30" }); await admin.markRead({ postId: "cursor-45" }); await behind.markRead({ postId: opening.id });
    const otherPost = (await db.query.forumPost.findMany({ where: eq(forumPost.threadId, other) }))[0]!;
    await reader.markRead({ postId: otherPost.id });
    const unaffected = (await db.query.forumRead.findMany()).filter(r => r.threadId !== id || r.userId !== playerId);
    expect((await reader.resolvePost({ postId: "cursor-30" }))?.page).toBe(2);
    const remove = (postId: string) => path === "staff"
      ? admin.moderatePost({ postId, action: "REMOVE", reason: "Remove an off-topic message" })
      : comments().then(api => api.deleteForumComment({ id: postId }));
    expect((await remove("cursor-30")).success).toBe(true);
    const resumed = (await reader.getThreads({ boardId: "general", view: "unread", limit: 20 })).threads.find(t => t.id === id)!;
    expect(resumed).toMatchObject({ unread: true, resumePostId: "cursor-28" });
    expect(await reader.resolvePost({ postId: resumed.resumePostId! })).toMatchObject({ threadId: id, page: 2 });
    expect(await reader.resolvePost({ postId: "cursor-30" })).toBeNull();
    expect((await db.query.forumRead.findMany()).filter(r => r.threadId !== id || r.userId !== playerId)).toEqual(unaffected);
    expect((await admin.getThreads({ boardId: "general", view: "unread", limit: 20 })).threads.some(t => t.id === id)).toBe(false);
    await reader.markRead({ postId: "cursor-45" }); await reader.markRead({ postId: "cursor-28" });
    expect((await reader.personal()).reads.find(r => r.threadId === id)?.postId).toBe("cursor-45");
    expect((await remove(opening.id)).success).toBe(true);
    expect((await behind.personal()).reads.some(r => r.threadId === id)).toBe(false);
    expect((await behind.getThreads({ boardId: "general", view: "unread", limit: 20 })).threads.find(t => t.id === id)).toMatchObject({ unread: true, resumePostId: null });
  });
  it("clears only source reading positions moved by a split and preserves direct post links", async () => {
    const db = await getTestDatabase(); const id = await create(); const other = await create("other");
    const opening = (await db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) }))[0]!;
    await db.update(forumPost).set({ createdAt: new Date(1000) }).where(eq(forumPost.id, opening.id));
    await db.insert(forumPost).values([
      { id: "split-middle", threadId: id, userId: playerId, authorId: playerId, content: "A tangent to separate", createdAt: new Date(2000) },
      { id: "split-last", threadId: id, userId: playerId, authorId: playerId, content: "Later advice in the original discussion", createdAt: new Date(3000) },
    ]);
    const reader = await client(); const admin = await client(adminId); const behind = await client(moderatorId);
    await reader.markRead({ postId: "split-middle" }); await admin.markRead({ postId: "split-last" }); await behind.markRead({ postId: opening.id });
    const otherPost = (await db.query.forumPost.findMany({ where: eq(forumPost.threadId, other) }))[0]!;
    await reader.markRead({ postId: otherPost.id }); const before = await db.query.forumRead.findMany();
    expect((await admin.restructureTopic({ threadId: id, action: "COPY", title: "Copied discussion", reason: "Share this discussion", postIds: [] })).success).toBe(true);
    expect(await db.query.forumRead.findMany()).toEqual(before);
    const split = await admin.restructureTopic({ threadId: id, action: "SPLIT", title: "Separate tangent", reason: "Keep the original discussion focused", postIds: ["split-middle"] });
    expect(split.success).toBe(true);
    expect(await db.query.forumRead.findMany()).toEqual(before.filter(r => r.threadId !== id || r.userId !== playerId));
    expect((await reader.getThreads({ boardId: "general", view: "unread", limit: 20 })).threads.find(t => t.id === id)).toMatchObject({ unread: true, resumePostId: null });
    expect((await reader.resolvePost({ postId: "split-middle" }))?.threadId).toBe(split.threadId);
    await reader.markRead({ postId: opening.id });
    const resumed = (await reader.getThreads({ boardId: "general", limit: 20 })).threads.find(t => t.id === id)!;
    expect(resumed).toMatchObject({ unread: true, resumePostId: opening.id });
    expect((await reader.resolvePost({ postId: resumed.resumePostId! }))?.threadId).toBe(id);
    await reader.markRead({ postId: "split-last" }); await reader.markRead({ postId: opening.id });
    expect((await reader.getThreads({ boardId: "general", view: "unread", limit: 20 })).threads.some(t => t.id === id)).toBe(false);
  });
  it("rejects private forum evidence through the report integration", async () => {
    const id = await create("private-board", adminId); const db = await getTestDatabase(); const post = (await db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) }))[0]!;
    const result = await callerForDatabase(reportsRouter, playerId, db).create({ system: "forum_comment", system_id: post.id, reported_userId: adminId, reason: "Attempt to report a private source" });
    expect(result.success).toBe(false); expect(await db.query.userReport.findMany()).toHaveLength(0);
  });
  it("applies parent archives to editing and voting and keeps orphaned moderation private", async () => {
    const id = await create(); const db = await getTestDatabase(); const post = (await db.query.forumPost.findMany())[0]!;
    await db.update(forumBoard).set({ parentId: "other" }).where(eq(forumBoard.id, "general"));
    await db.update(forumBoard).set({ archived: true }).where(eq(forumBoard.id, "other"));
    expect((await (await comments()).editForumComment(commentInput(post.id, "Attempt an archived edit"))).success).toBe(false);
    expect((await (await client()).react({ postId: post.id, reaction: "helpful", active: true })).success).toBe(false);
    await db.update(forumPost).set({ isReported: true }).where(eq(forumPost.id, post.id)); await db.delete(forumSection).where(eq(forumSection.id, "public"));
    expect(await (await client(moderatorId)).administration({ query: "" })).toBeNull();
  });
  it("preserves searchable administrator audit history after removing a board without widening scoped staff access", async () => {
    const db = await getTestDatabase(); const id = await create(); const admin = await client(adminId); const moderator = await client(moderatorId);
    expect((await admin.lockThread({ thread_id: id, status: true })).success).toBe(true);
    expect((await moderator.administration({ query: id }))?.logs.some(log => log.action === "topic.lock")).toBe(true);
    expect((await admin.removeStructure({ type: "BOARD", id: "general", destinationId: "other", reason: "Consolidate related discussions" })).success).toBe(true);
    expect((await db.query.forumThread.findFirst({ where: eq(forumThread.id, id) }))?.boardId).toBe("other");
    expect((await db.query.forumAudit.findMany()).some(log => log.action === "topic.lock" && log.targetId === id && log.boardId === "general")).toBe(true);
    expect((await admin.administration({ query: id }))?.logs.some(log => log.action === "topic.lock" && log.boardId === "general")).toBe(true);
    expect(await moderator.administration({ query: id })).toBeNull();
    await db.update(forumGrant).set({ scopeId: "other" }).where(eq(forumGrant.id, "scoped"));
    expect((await moderator.administration({ query: id }))?.logs).toEqual([]);
    expect(await listForumAudit(db, [], id)).toEqual([]);
  });
  it.each(["global", "approval-only"])("keeps visible scoped audit history ahead of unrelated %s events", async (scope) => {
    const db = await getTestDatabase(); const moderator = await client(moderatorId); const admin = await client(adminId);
    const id = await create();
    expect((await moderator.lockThread({ thread_id: id, status: true })).success).toBe(true);
    await db.insert(forumGrant).values({ id: "approval-scope", userId: moderatorId, scope: "BOARD", scopeId: "other", permissions: ["approve"], denies: [] });
    await db.update(forumBoard).set({ requireApproval: true }).where(eq(forumBoard.id, "other"));
    expect((await (await client()).createThread(topicInput("other"))).success).toBe(true);
    const pending = (await db.query.forumThread.findMany({ where: eq(forumThread.boardId, "other") }))[0]!;
    expect((await moderator.moderateThreads({ ids: [pending.id], action: "APPROVE", reason: "Review pending discussion" })).success).toBe(true);
    const visible = (await moderator.administration({ query: "" }))!.logs.map(log => log.id).sort();
    expect(visible).toHaveLength(2);
    for (let i = 0; i < 100; i++) {
      const result = scope === "global"
        ? await admin.saveGrant({ userId: playerId, scope: "GLOBAL", scopeId: "*", permissions: [], denies: [], reason: `Update player capabilities ${i}` })
        : await admin.lockThread({ thread_id: pending.id, status: i % 2 === 0 });
      expect(result.success).toBe(true);
    }
    expect((await moderator.administration({ query: id }))?.logs).toHaveLength(1);
    expect((await moderator.administration({ query: "" }))?.logs.map(log => log.id).sort()).toEqual(visible);
    expect((await admin.administration({ query: "" }))?.logs).toHaveLength(100);
    expect(await listForumAudit(db, [], "")).toEqual([]);
    await db.update(forumGrant).set({ permissions: [] }).where(eq(forumGrant.id, "scoped"));
    expect((await moderator.administration({ query: "" }))?.logs.map(log => log.action)).toEqual(["topic.approve"]);
  });
  it("searches reply content by its author and sends mention alerts without requiring a watch", async () => {
    const id = await create(); await (await comments(moderatorId)).createForumComment(commentInput(id, "A unique healing strategy for new players."));
    const result = await (await client()).getThreads({ author: "ForumModerator", query: "healing", limit: 20 }); expect(result.threads.map(t => t.id)).toEqual([id]);
    await (await comments()).createForumComment(commentInput(id, "Thanks @ForumModerator for the useful explanation."));
    expect(await (await client(moderatorId)).alerts()).toHaveLength(1);
  });
  it("records assigned review decisions and requires an explicit purge grant", async () => {
    const id = await create(); const db = await getTestDatabase(); const post = (await db.query.forumPost.findMany())[0]!;
    await db.update(forumPost).set({ isReported: true }).where(eq(forumPost.id, post.id)); const moderator = await client(moderatorId);
    expect((await moderator.reviewCase({ postId: post.id, assigneeId: moderatorId, status: "IN_REVIEW", reason: "Review the reported context" })).success).toBe(true);
    expect((await db.query.forumCase.findFirst())?.assigneeId).toBe(moderatorId);
    await moderator.reviewCase({ postId: post.id, assigneeId: moderatorId, status: "RESOLVED", reason: "Discussion follows forum rules" });
    expect((await db.query.forumPost.findFirst())?.isReported).toBe(false);
    await moderator.deleteThread({ thread_id: id }); const admin = await client(adminId);
    expect((await admin.purgeTopic({ threadId: id, confirmTitle: topicInput().title, reason: "Purge disposable fixture" })).success).toBe(false);
    await db.insert(forumGrant).values({ id: "purge-grant", userId: adminId, scope: "GLOBAL", scopeId: "*", permissions: ["purge"], denies: [] });
    expect((await admin.purgeTopic({ threadId: id, confirmTitle: topicInput().title, reason: "Purge disposable fixture" })).success).toBe(true);
    expect(await db.query.forumPost.findMany()).toHaveLength(0); expect(await db.query.forumThread.findMany()).toHaveLength(0); expect((await db.query.forumAudit.findMany()).some(a => a.action === "topic.purge")).toBe(true);
  });
  it("recounts a whole board with a set-based update", async () => {
    await create(); const db = await getTestDatabase(); await db.update(forumThread).set({ nPosts: 100 }); await db.update(forumBoard).set({ nPosts: 100 });
    expect((await (await client(adminId)).repairCounters({ boardId: "general" })).success).toBe(true);
    expect((await db.query.forumThread.findFirst())?.nPosts).toBe(1); expect((await db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "general") }))?.nPosts).toBe(1);
  });



  it("embeds live polls with shared votes, checks board voting permissions and records summaries", async () => {
    const db = await getTestDatabase(); const id = await create();
    await db.update(userData).set({ rank: "JONIN" }).where(eq(userData.userId, playerId));
    await db.insert(poll).values({ id: "community-poll", title: "Next community guide", description: "<p>Choose a useful guide.</p>", createdByUserId: adminId });
    await db.insert(pollOption).values([{ id: "healing", pollId: "community-poll", text: "Healing", createdByUserId: adminId }, { id: "raids", pollId: "community-poll", text: "Raids", createdByUserId: adminId }]);
    const admin = await client(adminId); const player = await client();
    const extras = { threadId: id, pollId: "community-poll", summary: "Community advice: focus on one role and keep resources for equipment.", reason: "Summarize useful answers and link our public poll" };
    expect((await player.saveTopicExtras(extras)).success).toBe(false);
    expect((await admin.saveTopicExtras(extras)).success).toBe(true);
    expect((await db.query.forumThread.findFirst())?.summary).toBe(extras.summary);
    expect((await player.votePoll({ threadId: id, optionId: "healing" })).success).toBe(true);
    let embedded = await player.threadPoll({ threadId: id }); expect(embedded?.totalVotes).toBe(1); expect(embedded?.userOptionId).toBe("healing"); expect(embedded?.description).not.toContain("<p>");
    expect((await player.votePoll({ threadId: id, optionId: "raids" })).success).toBe(true);
    embedded = await player.threadPoll({ threadId: id }); expect(embedded?.totalVotes).toBe(1); expect(embedded?.userOptionId).toBe("raids");
    expect((await player.votePoll({ threadId: id, optionId: null })).success).toBe(true); expect((await player.threadPoll({ threadId: id }))?.totalVotes).toBe(0);
    await db.update(forumBoard).set({ policy: { vote: "NONE" } }).where(eq(forumBoard.id, "general"));
    expect((await player.votePoll({ threadId: id, optionId: "healing" })).success).toBe(false);
    await db.update(forumBoard).set({ sectionId: "private" }).where(eq(forumBoard.id, "general")); expect(await player.threadPoll({ threadId: id })).toBeNull();
  });
  it("scopes attachment libraries and analytics to the viewer's account and boards", async () => {
    const db = await getTestDatabase();
    await db.insert(userUpload).values([{ id: "own-image", userId: playerId, imageUrl: "https://example.com/own.png" }, { id: "other-image", userId: adminId, imageUrl: "https://example.com/other.png" }]);
    const player = await client(); expect((await player.uploads()).map(upload => upload.id)).toEqual(["own-image"]); expect(await player.analytics({ days: 30 })).toBeNull();
    const id = await create(); await (await comments()).createForumComment(commentInput(id)); await create("private-board", adminId);
    const opening = (await db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) }))[0]!;
    expect((await (await comments()).editForumComment(commentInput(opening.id, "Updated author advice."))).success).toBe(true);
    await (await client(moderatorId)).lockThread({ thread_id: id, status: true });
    const scoped = await (await client(moderatorId)).analytics({ days: 7 }); expect(scoped?.boards.map(b => b.id)).toEqual(["general"]); expect(scoped?.boards[0]).toMatchObject({ topics: 1, posts: 2, participants: 1 }); expect(scoped?.daily.reduce((n, d) => n + d.posts, 0)).toBe(2); expect(scoped?.reviewers[0]?.actions).toBe(1); expect(scoped?.reviewers.some(r => r.actorId === playerId)).toBe(false);
    const all = await (await client(adminId)).analytics({ days: 30 }); expect(all?.boards.find(b => b.id === "private-board")?.posts).toBe(1);
  });
  it("keeps delegated moderation usable while a forum posting restriction blocks contributions", async () => {
    const id = await create(); const db = await getTestDatabase();
    await db.insert(forumRestriction).values({ id: "moderator-posting-restriction", userId: moderatorId, boardId: "general", reason: "Posting paused independently of review work", expiresAt: new Date(Date.now() + 60_000) });
    const moderator = await client(moderatorId);
    expect((await moderator.lockThread({ thread_id: id, status: true })).success).toBe(true);
    expect((await moderator.saveTopicExtras({ threadId: id, pollId: null, summary: "A reviewed topic summary", reason: "Maintain the existing review responsibility" })).success).toBe(true);
    expect((await moderator.createThread(topicInput())).success).toBe(false);
    expect((await (await comments(moderatorId)).createForumComment(commentInput(id))).success).toBe(false);
  });
  it("attributes a staff removal through the comments endpoint correctly", async () => {
    await create(); const db = await getTestDatabase(); const post = (await db.query.forumPost.findMany())[0]!;
    expect((await (await comments(moderatorId)).deleteForumComment({ id: post.id })).success).toBe(true);
    expect((await db.query.forumPost.findFirst())?.removalReason).toBe("Moderator removal");
    const audit = (await db.query.forumAudit.findMany()).find(a => a.action === "post.moderator-remove");
    expect(audit?.reason).toBe("Moderator removal");
  });
  it("rejects stale public News publication after its guest access changes", async () => {
    const db = await getTestDatabase();
    const stale = new Proxy(db, { get(target, key, receiver) { if (key === "transaction") return async (work: Parameters<DrizzleClient["transaction"]>[0]) => { await db.update(forumBoard).set({ policy: { read: "STAFF", create: "STAFF" } }).where(eq(forumBoard.id, "news")); return target.transaction(work); }; return Reflect.get(target, key, receiver); } });
    expect((await (await client(adminId, stale)).createThread(topicInput("news"))).success).toBe(false); expect(await db.query.forumThread.findMany()).toHaveLength(0);
  });
  it("publishes approved public News once and keeps private News private", async () => {
    const db = await getTestDatabase();
    const broadcasts = ["callDiscordNews", "callFacebookNews", "callRedditNews", "callTwitterNews", "callInstagramNews"].map(name => vi.spyOn(socials, name as "callDiscordNews").mockResolvedValue(undefined as never));
    await db.update(forumBoard).set({ requireApproval: true, policy: { create: "MEMBERS" } }).where(eq(forumBoard.id, "news"));
    expect((await (await client()).createThread(topicInput("news"))).success).toBe(true);
    const topic = (await db.query.forumThread.findMany())[0]!;
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, moderatorId) }))?.unreadNews).toBe(0);
    const admin = await client(adminId);
    await admin.moderateThreads({ ids: [topic.id], action: "APPROVE", reason: "Publish reviewed announcement" });
    await admin.moderateThreads({ ids: [topic.id], action: "APPROVE", reason: "Repeated approval" });
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, moderatorId) }))?.unreadNews).toBe(1);
    expect(broadcasts[0]).toHaveBeenCalledTimes(1);
    await db.update(forumBoard).set({ policy: { view: "MEMBERS", read: "MEMBERS", create: "MEMBERS" } }).where(eq(forumBoard.id, "news"));
    await (await client()).createThread(topicInput("news"));
    const pending = (await db.query.forumThread.findMany()).find(t => !t.isApproved)!;
    await admin.moderateThreads({ ids: [pending.id], action: "APPROVE", reason: "Private announcement" });
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, moderatorId) }))?.unreadNews).toBe(1);
    expect(broadcasts[0]).toHaveBeenCalledTimes(1);
  });
  it("supports approval-only staff and notifies watchers and mentions once after approval", async () => {
    const db = await getTestDatabase(); await db.update(forumGrant).set({ permissions: ["approve"] }).where(eq(forumGrant.id, "scoped")); await db.update(forumBoard).set({ requireApproval: true }).where(eq(forumBoard.id, "general"));
    const admin = await client(adminId); const approver = await client(moderatorId); await admin.watch({ scope: "BOARD", scopeId: "general", active: true, push: false });
    expect((await (await client()).createThread({ ...topicInput(), content: "A question for @ForumModerator and @ForumAdmin." })).success).toBe(true);
    const topic = (await db.query.forumThread.findMany())[0]!; expect(await admin.alerts()).toHaveLength(0);
    const workspace = await approver.administration({ query: "" }); expect(workspace?.threads.map(t => t.id)).toEqual([topic.id]);
    expect((await approver.lockThread({ thread_id: topic.id, status: true })).success).toBe(false);
    expect((await approver.moderateThreads({ ids: [topic.id], action: "APPROVE", reason: "Opening post reviewed" })).success).toBe(true);
    expect(await admin.alerts()).toHaveLength(1); expect(await approver.alerts()).toHaveLength(1);
    await approver.moderateThreads({ ids: [topic.id], action: "APPROVE", reason: "Repeated approval is harmless" }); expect(await admin.alerts()).toHaveLength(1);
    await (await comments()).createForumComment(commentInput(topic.id, "Another question for @ForumAdmin."));
    const pending = (await db.query.forumPost.findMany()).find(p => !p.isApproved)!; expect(await admin.alerts()).toHaveLength(1);
    expect((await approver.moderatePost({ postId: pending.id, action: "APPROVE", reason: "Reply reviewed" })).success).toBe(true); expect(await admin.alerts()).toHaveLength(2);
  });
  it.each([false, true])("rewinds only readers past a newly approved reply, including timestamp ties (%s)", async (sameTime) => {
    const db = await getTestDatabase(); const id = await create(); const other = await create("other");
    const opening = (await db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) }))[0]!;
    await db.update(forumPost).set({ createdAt: new Date(1000) }).where(eq(forumPost.id, opening.id));
    const priorAt = new Date(2000); const pendingAt = new Date(sameTime ? 2000 : 3000); const latestAt = new Date(sameTime ? 2000 : 4000);
    await db.insert(forumPost).values([
      { id: sameTime ? "a-prior" : "zz-prior", threadId: id, userId: adminId, authorId: adminId, content: "Already published advice", createdAt: priorAt },
      { id: "m-pending", threadId: id, userId: playerId, authorId: playerId, content: "Pending advice submitted before the staff reply", createdAt: pendingAt, isApproved: false },
      { id: "z-latest", threadId: id, userId: adminId, authorId: adminId, content: "Later published staff reply", createdAt: latestAt },
    ]);
    await db.update(forumThread).set({ nPosts: 3, lastPostId: "z-latest", updatedAt: latestAt }).where(eq(forumThread.id, id));
    const reader = await client(moderatorId); const behind = await client(); const admin = await client(adminId);
    await reader.markRead({ postId: "z-latest" }); await behind.markRead({ postId: opening.id });
    const otherPost = (await db.query.forumPost.findMany({ where: eq(forumPost.threadId, other) }))[0]!;
    await reader.markRead({ postId: otherPost.id });
    const unaffected = (await db.query.forumRead.findMany()).filter(r => r.threadId === other || r.userId === playerId);
    expect((await reader.getThreads({ boardId: "general", view: "unread", limit: 20 })).threads).toHaveLength(0);
    expect((await admin.moderatePost({ postId: "m-pending", action: "APPROVE", reason: "Publish reviewed advice" })).success).toBe(true);
    const unread = await reader.getThreads({ boardId: "general", view: "unread", limit: 20 });
    expect(unread.threads[0]).toMatchObject({ id, unread: true, resumePostId: sameTime ? "a-prior" : "zz-prior", updatedAt: latestAt, lastPostId: "z-latest" });
    expect((await reader.resolvePost({ postId: unread.threads[0]!.resumePostId! }))?.threadId).toBe(id);
    expect((await db.query.forumRead.findMany()).filter(r => r.threadId === other || r.userId === playerId)).toEqual(unaffected);
    expect((await db.query.forumPost.findFirst({ where: eq(forumPost.id, "m-pending") }))?.createdAt).toEqual(pendingAt);
    await reader.markRead({ postId: "z-latest" });
    await admin.moderatePost({ postId: "m-pending", action: "APPROVE", reason: "Repeated approval" });
    expect((await reader.getThreads({ boardId: "general", view: "unread", limit: 20 })).threads).toHaveLength(0);
    expect((await reader.personal()).reads.find(r => r.threadId === id)?.postId).toBe("z-latest");
  });
  it.each(["post", "topic"])("recovers unread opening posts through %s approval without a previous visible post", async (path) => {
    const db = await getTestDatabase(); const id = await create(); const reader = await client(moderatorId); const admin = await client(adminId);
    const opening = (await db.query.forumPost.findMany())[0]!;
    await (await comments(adminId)).createForumComment(commentInput(id, "A later staff reply already read by this reader"));
    const latest = (await db.query.forumPost.findMany()).find(p => p.id !== opening.id)!;
    await reader.markRead({ postId: latest.id });
    await db.update(forumPost).set({ isApproved: false }).where(eq(forumPost.id, opening.id));
    const approve = () => path === "post"
      ? admin.moderatePost({ postId: opening.id, action: "APPROVE", reason: "Publish the opening post" })
      : admin.moderateThreads({ ids: [id], action: "APPROVE", reason: "Publish the opening post" });
    expect((await approve()).success).toBe(true);
    expect((await reader.getThreads({ boardId: "general", view: "unread", limit: 20 })).threads[0]).toMatchObject({ id, unread: true, resumePostId: null });
    await reader.markRead({ postId: latest.id }); await approve();
    expect((await reader.getThreads({ boardId: "general", view: "unread", limit: 20 })).threads).toHaveLength(0);
    expect((await db.query.forumPost.findFirst({ where: eq(forumPost.id, opening.id) }))?.createdAt).toEqual(opening.createdAt);
  });
  it("keeps reading positions when approval does not publish removed content", async () => {
    const id = await create(); const db = await getTestDatabase(); const reader = await client(moderatorId); const admin = await client(adminId);
    const post = (await db.query.forumPost.findMany())[0]!; await reader.markRead({ postId: post.id });
    const before = await db.query.forumRead.findMany();
    await db.update(forumPost).set({ isApproved: false, deletedAt: new Date() }).where(eq(forumPost.id, post.id));
    await admin.moderatePost({ postId: post.id, action: "APPROVE", reason: "Approve while removed" });
    expect(await db.query.forumRead.findMany()).toEqual(before);
    await db.update(forumPost).set({ isApproved: false, deletedAt: null }).where(eq(forumPost.id, post.id));
    await db.update(forumThread).set({ deletedAt: new Date() }).where(eq(forumThread.id, id));
    await admin.moderatePost({ postId: post.id, action: "APPROVE", reason: "Approve in a removed topic" });
    expect(await db.query.forumRead.findMany()).toEqual(before);
    await db.update(forumPost).set({ isApproved: false }).where(eq(forumPost.id, post.id));
    await admin.moderateThreads({ ids: [id], action: "APPROVE", reason: "Approve a removed topic" });
    expect(await db.query.forumRead.findMany()).toEqual(before);
  });
  it("keeps older pending reviews reachable without exposing recovery records to approvers", async () => {
    const db = await getTestDatabase();
    await db.update(forumGrant).set({ permissions: ["approve"] }).where(eq(forumGrant.id, "scoped"));
    await db.insert(forumThread).values({ id: "pending", boardId: "general", title: "Pending discussion", userId: playerId, isApproved: false, createdAt: new Date(1000), updatedAt: new Date(1000) });
    await db.insert(forumPost).values({ id: "pending-post", threadId: "pending", userId: playerId, authorId: playerId, content: "Opening post awaiting approval", isApproved: false, createdAt: new Date(1000) });
    await db.insert(forumThread).values(Array.from({ length: 100 }, (_, i) => ({ id: `removed-${i}`, boardId: "general", title: "Removed discussion", userId: playerId, deletedAt: new Date(2000), createdAt: new Date(2000), updatedAt: new Date(2000) })));
    await db.insert(forumPost).values(Array.from({ length: 100 }, (_, i) => ({ id: `removed-post-${i}`, threadId: `removed-${i}`, userId: playerId, authorId: playerId, content: "Retained removed content", deletedAt: new Date(2000), createdAt: new Date(2000) })));
    await db.insert(forumPost).values({ id: "removed-topic-pending-post", threadId: "removed-0", userId: playerId, authorId: playerId, content: "Pending content in a removed topic", isApproved: false, createdAt: new Date(2000) });
    const approver = await (await client(moderatorId)).administration({ query: "" });
    expect(approver?.threads.map(t => t.id)).toEqual(["pending"]);
    expect(approver?.posts.map(p => p.post.id)).toEqual(["pending-post"]);
    expect(approver?.hasMoreReviews).toBe(false);
    const admin = await client(adminId);
    const first = await admin.administration({ query: "" });
    expect(first?.threads).toHaveLength(100); expect(first?.posts).toHaveLength(100); expect(first?.hasMoreReviews).toBe(true);
    const second = await admin.administration({ query: "", reviewPage: 1 });
    expect(second?.threads.map(t => t.id)).toEqual(["pending"]);
    expect(second?.posts.some(p => p.post.id === "pending-post")).toBe(true);
    expect(second?.hasMoreReviews).toBe(false);
    expect(second?.posts.some(p => first?.posts.some(firstPost => firstPost.post.id === p.post.id))).toBe(false);
  });
  it("paginates approval-only queues after board scope and recovery visibility", async () => {
    const db = await getTestDatabase();
    await db.update(forumGrant).set({ permissions: ["approve"] }).where(eq(forumGrant.id, "scoped"));
    await db.insert(forumThread).values(Array.from({ length: 102 }, (_, i) => ({ id: `pending-${i}`, boardId: i === 101 ? "private-board" : "general", title: "Pending discussion", userId: playerId, isApproved: false, updatedAt: new Date(1000) })));
    await db.insert(forumPost).values(Array.from({ length: 102 }, (_, i) => ({ id: `pending-post-${i}`, threadId: `pending-${i}`, userId: playerId, authorId: playerId, content: "Pending reply", isApproved: false, createdAt: new Date(1000) })));
    const approver = await client(moderatorId);
    const first = await approver.administration({ query: "" });
    const second = await approver.administration({ query: "", reviewPage: 1 });
    expect(first?.threads).toHaveLength(100); expect(first?.posts).toHaveLength(100); expect(first?.hasMoreReviews).toBe(true);
    expect(second?.threads).toHaveLength(1); expect(second?.posts).toHaveLength(1); expect(second?.hasMoreReviews).toBe(false);
    const topics = [...first!.threads, ...second!.threads]; const posts = [...first!.posts, ...second!.posts];
    expect(new Set(topics.map(t => t.id)).size).toBe(101); expect(new Set(posts.map(p => p.post.id)).size).toBe(101);
    expect(topics.every(t => t.boardId === "general")).toBe(true); expect(posts.every(p => p.thread.boardId === "general")).toBe(true);
  });
  it("rejects a post moved after preload and an author removal after a post lock", async () => {
    const topicId = await create(); const privateId = await create("private-board", adminId); const db = await getTestDatabase(); const post = (await db.query.forumPost.findMany({ where: eq(forumPost.threadId, topicId) }))[0]!;
    const beforeTransaction = (change: () => Promise<unknown>) => new Proxy(db, { get(target, key, receiver) { if (key === "transaction") return async (work: Parameters<DrizzleClient["transaction"]>[0]) => { await change(); return target.transaction(work); }; return Reflect.get(target, key, receiver); } });
    const moved = beforeTransaction(() => db.update(forumPost).set({ threadId: privateId }).where(eq(forumPost.id, post.id)) as unknown as Promise<unknown>);
    expect((await (await client(moderatorId, moved)).moderatePost({ postId: post.id, action: "LOCK", reason: "Stale scope must reject" })).success).toBe(false);
    expect((await db.query.forumPost.findFirst({ where: eq(forumPost.id, post.id) }))?.isLocked).toBe(false);
    await db.update(forumPost).set({ threadId: topicId }).where(eq(forumPost.id, post.id));
    const locked = beforeTransaction(() => db.update(forumPost).set({ isLocked: true }).where(eq(forumPost.id, post.id)) as unknown as Promise<unknown>);
    expect((await (await comments(playerId, locked)).deleteForumComment({ id: post.id })).success).toBe(false);
    expect((await db.query.forumPost.findFirst({ where: eq(forumPost.id, post.id) }))?.deletedAt).toBeNull();
  });
  it("preserves type, tags and accepted answers when moving a topic without metadata edits", async () => {
    const player = await client(); const result = await player.createThread({ ...topicInput(), kind: "QUESTION", tags: ["healing"] }); const id = result.threadId!;
    await (await comments(moderatorId)).createForumComment(commentInput(id)); const db = await getTestDatabase(); const reply = (await db.query.forumPost.findMany()).find(p => p.authorId === moderatorId)!;
    await player.acceptAnswer({ threadId: id, postId: reply.id });
    expect((await (await client(adminId)).moderateThreads({ ids: [id], action: "UPDATE", boardId: "other", reason: "Move without changing topic metadata" })).success).toBe(true);
    expect(await db.query.forumThread.findFirst({ where: eq(forumThread.id, id) })).toMatchObject({ boardId: "other", kind: "QUESTION", tags: ["healing"], acceptedPostId: reply.id });
  });

});
