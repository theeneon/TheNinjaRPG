/**
 * Database access for forum; authorization and transaction scopes stay in callers.
 */
import { eq } from "drizzle-orm";
import { forumThread } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/**
 * Internal convenience function to fetch a forum thread by ID.
 * Used by this router and the comments router for thread management operations.
 */
export const fetchThread = async (client: DrizzleClient, threadId: string) => {
  return await client.query.forumThread.findFirst({
    where: eq(forumThread.id, threadId),
  });
};

import { asc, desc, ne, sql } from "drizzle-orm";
import { forumBoard, forumPost, userData, userDevice } from "@/drizzle/schema";

/** Build the `forumThread` listing for `umThreadForGetInfiniteThreads`, using predicates on `boardId`, `id`, `name`. */
export const listForumThreadForGetInfiniteThreads = (
  client: Pick<DrizzleClient, "query" | "select">,
  skip: number,
  limit: number,
  boardId: undefined | string,
  boardName: undefined | string,
  highlightPinned: undefined | false | true,
) =>
  client.query.forumThread.findMany({
    offset: skip,
    limit: limit,
    where: eq(
      forumThread.boardId,
      boardId ||
        client
          .select({ id: forumBoard.id })
          .from(forumBoard)
          .where(eq(forumBoard.name, boardName ?? "")),
    ),
    with: {
      user: {
        columns: { username: true },
      },
      posts: {
        limit: 1,
        orderBy: asc(forumPost.createdAt),
      },
    },
    orderBy: highlightPinned
      ? [desc(forumThread.isPinned), desc(forumThread.createdAt)]
      : desc(forumThread.createdAt),
  });

/** Build the `forumBoard` lookup for `umBoardForFetchBoard`, using predicates on `id` and `name`. */
export const findForumBoardForFetchBoard = (
  client: Pick<DrizzleClient, "query">,
  boardId: undefined | string,
  boardName: undefined | string,
) =>
  client.query.forumBoard.findFirst({
    where: boardId
      ? eq(forumBoard.id, boardId ?? "")
      : eq(forumBoard.name, boardName ?? ""),
  });

/** Mark the account's news feed as read by clearing its unreadNews counter. */
export const readNews = async (client: DrizzleClient, userId: string) => {
  await client
    .update(userData)
    .set({ unreadNews: 0 })
    .where(eq(userData.userId, userId));
};

/** Build the `userData` lookup for `fetchForumPageData`, using predicates on `userId`. */
export const findUserDataForFetchForumPageData = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { userId: true, role: true, unreadNews: true },
  });

/** Build the `forumBoard` listing for `umBoardForGetAll`. */
export const listForumBoardForGetAll = (client: Pick<DrizzleClient, "query">) =>
  client.query.forumBoard.findMany({
    orderBy: asc(forumBoard.createdAt),
  });

/** Build the `forumThread` insert for `umThreadForCreateThread`. */
export const insertForumThreadForCreateThread = (
  client: Pick<DrizzleClient, "insert">,
  threadId: string,
  input: { title: string; image: null | string; board_id: string },
  effectiveUserId: string,
) =>
  client.insert(forumThread).values({
    id: threadId,
    title: input.title,
    image: input.image,
    boardId: input.board_id,
    userId: effectiveUserId,
  });

/** Build the `forumPost` insert for `umPostForCreateThread`. */
export const insertForumPostForCreateThread = (
  client: Pick<DrizzleClient, "insert">,
  postId: string,
  sanitized: string,
  threadId: string,
  effectiveUserId: string,
  ctx: { userId: string },
) =>
  client.insert(forumPost).values({
    id: postId,
    content: sanitized,
    threadId: threadId,
    userId: effectiveUserId,
    authorId: ctx.userId,
  });

/**
 * Build the `forumBoard` update for `umBoardForCreateThread`, setting `nThreads` and
 * `updatedAt`, using predicates on `id`.
 */
export const updateForumBoardForCreateThread = (
  client: Pick<DrizzleClient, "update">,
  input: { board_id: string },
) =>
  client
    .update(forumBoard)
    .set({ nThreads: sql`nThreads + 1`, updatedAt: new Date() })
    .where(eq(forumBoard.id, input.board_id));

/** Build the `userData` update for `createThread`, setting `unreadNews`, using predicates on `userId`. */
export const updateUserDataForCreateThread = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ unreadNews: sql`LEAST(unreadNews + 1, 1000)` })
    .where(ne(userData.userId, ctx.userId));

/** Build the `forumThread` update for `umThreadForPinThread`, setting `isPinned`, using predicates on `id`. */
export const updateForumThreadForPinThread = (
  client: Pick<DrizzleClient, "update">,
  input: { status: false | true },
  thread: { id: string },
) =>
  client
    .update(forumThread)
    .set({ isPinned: input.status })
    .where(eq(forumThread.id, thread.id));

/** Build the `forumThread` update for `umThreadForLockThread`, setting `isLocked`, using predicates on `id`. */
export const updateForumThreadForLockThread = (
  client: Pick<DrizzleClient, "update">,
  input: { status: false | true },
  thread: { id: string },
) =>
  client
    .update(forumThread)
    .set({ isLocked: input.status })
    .where(eq(forumThread.id, thread.id));

/** Build the `forumThread` deletion for `umThreadForDeleteThread`, using predicates on `id`. */
export const deleteForumThreadForDeleteThread = (
  client: Pick<DrizzleClient, "delete">,
  thread: { id: string },
) => client.delete(forumThread).where(eq(forumThread.id, thread.id));

/** Build the `forumBoard` update for `umBoardForDeleteThread`, setting `nThreads`, using predicates on `id`. */
export const updateForumBoardForDeleteThread = (
  client: Pick<DrizzleClient, "update">,
  thread: { boardId: string },
) =>
  client
    .update(forumBoard)
    .set({ nThreads: sql`GREATEST(nThreads - 1, 0)` })
    .where(eq(forumBoard.id, thread.boardId));

/** Build the `forumPost` deletion for `umPostForDeleteThread`, using predicates on `threadId`. */
export const deleteForumPostForDeleteThread = (
  client: Pick<DrizzleClient, "delete">,
  thread: { id: string },
) => client.delete(forumPost).where(eq(forumPost.threadId, thread.id));

/** Build the `userDevice` distinct selection for `notifyNewsSubscribers`. */
export const selectDistinctUserDeviceForNotifyNewsSubscribers = (
  client: Pick<DrizzleClient, "selectDistinct">,
) => client.selectDistinct({ userId: userDevice.userId }).from(userDevice);

/** Build the board summary lookup with its thread count for public metadata. */
export const findForumBoardMetadata = (
  client: Pick<DrizzleClient, "query">,
  boardId: string,
) =>
  client.query.forumBoard.findFirst({
    columns: { name: true, summary: true, nThreads: true },
    where: eq(forumBoard.id, boardId),
  });

/** Build the thread title, post count and owning-board lookup for canonical public metadata. */
export const findForumThreadMetadata = (
  client: Pick<DrizzleClient, "query">,
  threadId: string,
) =>
  client.query.forumThread.findFirst({
    columns: { title: true, nPosts: true, boardId: true },
    where: eq(forumThread.id, threadId),
  });

/** Build a name-only board lookup without loading the board summary or counters. */
export const findForumBoardNameById = (
  client: Pick<DrizzleClient, "query">,
  boardId: string,
) =>
  client.query.forumBoard.findFirst({
    columns: { name: true },
    where: eq(forumBoard.id, boardId),
  });
