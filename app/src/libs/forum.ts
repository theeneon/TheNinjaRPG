import * as Sentry from "@sentry/nextjs";
import {
  findForumBoardForFetchBoard,
  findUserDataForFetchForumPageData,
  listForumThreadForGetInfiniteThreads,
} from "@/queries/forum";
import type { DrizzleClient } from "@/server/db";
import { canCreateNews } from "@/utils/permissions";

export const getInfiniteThreads = async (props: {
  client: DrizzleClient;
  limit: number;
  highlightPinned?: boolean;
  cursor?: number | null;
  boardId?: string;
  boardName?: string;
}) => {
  const { client, boardId, boardName, cursor, limit, highlightPinned } = props;
  if (!boardId && !boardName) return { board: null, threads: [], nextCursor: null };
  const currentCursor = cursor ? cursor : 0;
  const skip = currentCursor * limit;
  const [board, threads] = await Promise.all([
    fetchBoard(client, boardId, boardName),
    listForumThreadForGetInfiniteThreads(
      client,
      skip,
      limit,
      boardId,
      boardName,
      highlightPinned,
    ),
  ]);
  if (!board) return { board: null, threads: [], nextCursor: null };
  const nextCursor = threads.length < limit ? null : currentCursor + 1;
  return { board, threads, nextCursor };
};
export type InfiniteThreads = ReturnType<typeof getInfiniteThreads>;

export const fetchBoard = async (
  client: DrizzleClient,
  boardId?: string,
  boardName?: string,
) => {
  if (!boardId && !boardName) return null;
  const entry = await findForumBoardForFetchBoard(client, boardId, boardName);
  return entry ?? null;
};

export const fetchForumPageData = async (
  client: DrizzleClient,
  boardName: string,
  userId: string | null,
) => {
  const initialThreadsPromise = getInfiniteThreads({
    client,
    boardName,
    limit: 10,
  });

  const userDataPromise = userId
    ? findUserDataForFetchForumPageData(client, userId).catch((error) => {
        if (error.message?.includes("not found")) {
          return null;
        }
        console.error("Failed to fetch user:", error);
        Sentry.captureException(error, {
          tags: { source: "forum-fetch-user" },
        });
        return null;
      })
    : Promise.resolve(null);

  const [initialThreads, userRow] = await Promise.all([
    initialThreadsPromise,
    userDataPromise,
  ]);
  const pageUser = userRow ?? null;
  const canPost = pageUser && canCreateNews(pageUser.role);
  return { initialThreads, userData: pageUser, canPost };
};
