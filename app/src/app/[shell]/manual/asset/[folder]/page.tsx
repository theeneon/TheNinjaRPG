import { redirect } from "next/navigation";

/** Keep bookmarked folder links in the unified, searchable library. */
export default async function ManualAssetsFolderPage({
  params,
}: {
  params: Promise<{ folder: string }>;
}) {
  const { folder } = await params;
  // Route parameters are re-encoded by Next; decode once before encoding the query value.
  redirect(
    `/manual/asset?${new URLSearchParams({ folder: decodeURIComponent(folder) })}`,
  );
}
