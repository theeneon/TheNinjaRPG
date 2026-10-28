import type { Metadata } from "next";
import { buildMetadata, noindexMetadata } from "@/libs/seo";
import { findForumBoardMetadata } from "@/queries/forum";
import { drizzleDB } from "@/server/db";

export async function generateMetadata(props: {
  params: Promise<{ boardid: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const board = await findForumBoardMetadata(drizzleDB, params.boardid);
  if (!board) return noindexMetadata("Board Not Found");
  return buildMetadata({
    title: `${board.name} Forum`,
    description: `${board.summary} Browse ${board.nThreads} discussions in the ${board.name} board on the TheNinja-RPG community forums.`,
    path: `/forum/${params.boardid}`,
  });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
