import { redirect } from "next/navigation";

/** Keep bookmarked folder links in the unified, searchable library. */
export default async function ManualAssetsFolderPage({
  params,
}: {
  params: Promise<{ folder: string }>;
}) {
  const { folder } = await params;
  redirect(`/manual/asset?${new URLSearchParams({ folder })}`);
}
