import * as socials from "@/libs/socials";
import { reportsRouter } from "@/routers/reports";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { forumAlert, forumAudit, forumBoard, forumGrant, forumPost, forumReaction, forumRead, forumRestriction, forumRevision, forumSection, forumThread, forumWatch, userData, userReport } from "@/drizzle/schema";
import { fetchForumThreadPage, getForumContext, getInfiniteThreads } from "@/libs/forum";
import * as moderation from "@/libs/moderation/defer";
import { commentsRouter } from "@/routers/comments";
import { forumRouter } from "@/routers/forum";
import type { DrizzleClient } from "@/server/db";
import { insertUsers } from "../../setup/factories";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

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
    await resetTables(userReport, forumAlert, forumAudit, forumGrant, forumReaction, forumRead, forumRestriction, forumRevision, forumWatch, forumPost, forumThread, forumBoard, forumSection, userData);
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
