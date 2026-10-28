import {
  QueryClient,
  QueryClientProvider,
  type UseMutationOptions,
  useInfiniteQuery,
  useMutation,
} from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import type { GameAsset } from "@/drizzle/schema";
import * as ContentBox from "@/layout/ContentBox";
import { GameAssetLibrary } from "@/layout/GameAssetLibrary";
import * as preview from "@/layout/GameAssetPreview";
import * as Link from "@/layout/Link";
import * as Modal from "@/layout/Modal";
import * as toast from "@/libs/toast";
import * as userContext from "@/utils/UserContext";
import { ensureDom } from "../setup/dom.mjs";

type Page = { data: GameAsset[]; nextCursor: number | null };
type Result = { success: boolean; message: string };
const asset: GameAsset = {
  id: "forest", name: "Forest", type: "STATIC", image: "https://example.com/forest.webp",
  url: "https://example.com/forest.webp", folder: "Scenes", frames: 1, speed: 50,
  hidden: false, licenseDetails: "TNR", onInitialBattleField: false,
  createdByUserId: "creator", createdAt: new Date(0), updatedAt: new Date(0),
};
const nextAsset: GameAsset = { ...asset, id: "lake", name: "Lake" };
let cache: QueryClient;
let deleted: boolean;
let failReads: boolean;
let hasMore: boolean;
const read = vi.fn(async (cursor: number | null): Promise<Page> => {
  if (failReads) throw new Error("Temporarily unavailable");
  return cursor
    ? { data: [nextAsset], nextCursor: null }
    : { data: deleted ? [] : [asset], nextCursor: hasMore ? 1 : null };
});

beforeEach(() => {
  ensureDom();
  deleted = false; failReads = false; hasMore = false; read.mockClear();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(navigation, "useSearchParams").mockReturnValue(new URLSearchParams() as never);
  vi.spyOn(userContext, "useUserData").mockReturnValue({ data: { role: "CONTENT" } } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children, topRightContent }) => <div>{topRightContent}{children}</div>);
  vi.spyOn(preview, "GameAssetPreview").mockImplementation(() => <></>);
  vi.spyOn(preview, "AssetPreviewBackgroundControls").mockImplementation(() => <></>);
  vi.spyOn(Link, "default").mockImplementation(({ children, href }) => <a href={String(href)}>{children}</a>);
  vi.spyOn(Modal, "default").mockImplementation(({ children, isOpen, title, onAccept, proceed_label, footerExtra }) => isOpen ? (
    <div role="dialog" aria-label={title}>
      {children}{footerExtra}
      {onAccept && <button type="button" onClick={onAccept}>{proceed_label}</button>}
    </div>
  ) : null);
  const noOp = async () => undefined;
  // Keep the real query and mutation lifecycle; isolate only transport and unrelated UI.
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      gameAsset: {
        getAll: { invalidate: () => cache.invalidateQueries({ queryKey: ["assets"] }) },
        getAllFolders: { invalidate: noOp }, getAllNames: { invalidate: noOp },
        getNameTags: { invalidate: noOp },
      },
      misc: { getAllGameAssetNames: { invalidate: noOp } },
    }),
    gameAsset: {
      getAll: { useInfiniteQuery: (_input: unknown, options: { getNextPageParam: (page: Page) => number | null }) => useInfiniteQuery({
        queryKey: ["assets"], queryFn: ({ pageParam }) => read(pageParam),
        initialPageParam: null as number | null, ...options,
      }) },
      getAllFolders: { useQuery: () => ({ data: [] }) },
      getNameTags: { useQuery: () => ({ data: { tags: [] } }) },
      delete: { useMutation: (options: UseMutationOptions<Result, Error, { id: string }>) => useMutation({
        mutationFn: async () => { deleted = true; return { success: true, message: "Deleted" }; },
        ...options,
      }) },
    },
  });
});

afterEach(() => {
  cleanup();
  cache.clear();
  vi.restoreAllMocks();
});

describe("asset library retry", () => {
  it("refreshes cached complete results after a failed post-delete invalidation", async () => {
    const view = render(<QueryClientProvider client={cache}><GameAssetLibrary /></QueryClientProvider>);
    fireEvent.click(await view.findByRole("button", { name: "Preview Forest" }));
    const deleteButton = view.getAllByRole("button", { name: /^Delete asset$/ }).find((element) => element.tagName === "BUTTON");
    fireEvent.click(deleteButton!);
    failReads = true;
    fireEvent.click(within(view.getByRole("dialog", { name: "Delete Forest?" })).getByRole("button", { name: "Delete asset" }));
    const failure = await view.findByRole("alert");
    const failureMessage = failure.textContent;
    expect(read).toHaveBeenCalledTimes(2);
    expect(view.getByText("1 asset loaded. You’re all caught up.")).toBeDefined();
    expect(view.getByRole("button", { name: "Preview Forest" })).toBeDefined();

    failReads = false;
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(view.queryByRole("button", { name: "Preview Forest" }) === null).toBe(true));
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls.at(-1)?.[0]).toBeNull();
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("Your library starts here")).toBeDefined();
    expect(failureMessage).toContain("Could not load the asset library.");
  });

  it("retries the failed next page without refetching loaded assets", async () => {
    hasMore = true;
    const view = render(<QueryClientProvider client={cache}><GameAssetLibrary /></QueryClientProvider>);
    await view.findByRole("button", { name: "Preview Forest" });
    failReads = true;
    fireEvent.click(view.getByRole("button", { name: "Load more assets" }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Could not load more assets."));
    expect(read.mock.calls.map(([cursor]) => cursor)).toEqual([null, 1]);
    expect(view.getByRole("button", { name: "Preview Forest" })).toBeDefined();

    failReads = false;
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await view.findByRole("button", { name: "Preview Lake" });
    expect(read.mock.calls.map(([cursor]) => cursor)).toEqual([null, 1, 1]);
    expect(view.getByRole("button", { name: "Preview Forest" })).toBeDefined();
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("2 assets loaded. You’re all caught up.")).toBeDefined();
  });
});
