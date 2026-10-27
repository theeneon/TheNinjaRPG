import type { Metadata } from "next";
import { buildMetadata, noindexMetadata } from "@/libs/seo";
import { findForumBoardNameById, findForumThreadMetadata } from "@/queries/forum";
import { drizzleDB } from "@/server/db";

export async function generateMetadata(props: {
  params: Promise<{ boardid: string; threadid: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  // forumThread has no board relation, so both are fetched in one parallel round-trip.
  const [thread, boardRow] = await Promise.all([
    findForumThreadMetadata(drizzleDB, params.threadid),
    findForumBoardNameById(drizzleDB, params.boardid),
  ]);
  if (!thread) return noindexMetadata("Thread Not Found");
  const board = boardRow?.name;
  return buildMetadata({
    title: thread.title,
    description: `${thread.title} - a discussion with ${thread.nPosts} ${
      thread.nPosts === 1 ? "post" : "posts"
    }${board ? ` in the ${board} board` : ""} on the TheNinja-RPG community forums.`,
    // Built from the thread's own boardId rather than the requested one. Any board id
    // resolves this route, so pairing a real thread with an unrelated board would
    // otherwise mint unlimited URLs that each declare themselves canonical.
    path: `/forum/${thread.boardId}/${params.threadid}`,
    type: "article",
  });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
