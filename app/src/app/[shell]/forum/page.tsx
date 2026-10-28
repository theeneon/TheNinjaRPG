"use client";

import { Bell, ChevronRight, MessageSquare } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useId, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ContentBox from "@/layout/ContentBox";
import { defineFilteringSchema, useContentFiltering } from "@/layout/ContentFiltering";
import { ForumNavigation, ForumSearch, ForumTopicList } from "@/layout/Forum";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { useUserData } from "@/utils/UserContext";

export const ForumSkeleton = () => <Loader explanation="Loading forum…" />;
export default function Forum() {
  return (
    <Suspense fallback={<ForumSkeleton />}>
      <ForumHome />
    </Suspense>
  );
}

function ForumHome() {
  const fieldPrefix = useId();
  const { data: user } = useUserData();
  const router = useRouter();
  const params = useSearchParams();
  const rawView = params.get("view") ?? "boards";
  const view = ["latest", "unread", "watched", "mine", "unanswered", "alerts"].includes(
    rawView,
  )
    ? rawView
    : "boards";
  const [query, setQuery] = useState("");
  const [boardId, setBoardId] = useState("");
  const filters = useContentFiltering(forumTextFilters);
  const { author, since, until } = filters.values;
  const { author: setAuthor, since: setSince, until: setUntil } = filters.setters;
  const { data: boards, isPending, error, refetch } = api.forum.getAll.useQuery();
  const topics = api.forum.getThreads.useInfiniteQuery(
    {
      limit: 20,
      view:
        view === "boards" || view === "alerts"
          ? "latest"
          : (view as "latest" | "unread" | "watched" | "mine" | "unanswered"),
      query,
      author: filters.debounced.author,
      boardId: boardId || undefined,
      tag: params.get("tag") ?? undefined,
      since: filters.debounced.since
        ? new Date(`${filters.debounced.since}T00:00:00`)
        : undefined,
      until: filters.debounced.until
        ? new Date(`${filters.debounced.until}T23:59:59.999`)
        : undefined,
    },
    {
      enabled: view !== "boards" && view !== "alerts",
      getNextPageParam: (p) => p.nextCursor,
      staleTime: 15000,
    },
  );
  const alerts = api.forum.alerts.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 60000,
  });
  const utils = api.useUtils();
  const readAlerts = api.forum.readAlerts.useMutation({
    onSuccess: () => utils.forum.alerts.invalidate(),
  });
  const sectionIds = [...new Set(boards?.map((b) => b.sectionId) ?? [])];
  return (
    <ContentBox
      title="Community forum"
      subtitle="Ask, share and write the next chapter of Seichi."
    >
      <ForumNavigation />
      <div className="mb-4">
        <ForumSearch
          onSearch={(text) => {
            setQuery(text);
            if (view === "boards" || view === "alerts")
              router.replace("/forum?view=latest");
          }}
        />
      </div>
      <nav
        aria-label="Discussion views"
        className="mb-4 flex flex-wrap gap-1 border-b pb-3"
      >
        {[
          ["boards", "Boards"],
          ["latest", "Latest"],
          ["unanswered", "Unanswered"],
          ...(user
            ? [
                ["unread", "Unread"],
                ["watched", "Watching"],
                ["mine", "My discussions"],
                [
                  "alerts",
                  `Alerts${alerts.data?.some((a) => !a.readAt) ? ` (${alerts.data.filter((a) => !a.readAt).length})` : ""}`,
                ],
              ]
            : []),
        ].map(([key, label]) => (
          <Link
            key={key}
            href={key === "boards" ? "/forum" : `/forum?view=${key}`}
            aria-current={view === key ? "page" : undefined}
            className={`rounded-md px-3 py-2 text-sm ${view === key ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {error && (
        <p role="alert">
          The forum could not load.{" "}
          <Button variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </p>
      )}
      {isPending && <ForumSkeleton />}
      {view === "boards" && boards && (
        <div className="space-y-6">
          {sectionIds.map((id) => {
            const group = boards.filter((b) => b.sectionId === id);
            const section = group[0]?.section;
            return (
              <section key={id}>
                <div className="mb-2">
                  <h2 className="text-lg font-semibold">
                    {section?.name ?? "Other boards"}
                    {section?.archived && " (archived)"}
                  </h2>
                  {section?.summary && (
                    <p className="text-muted-foreground text-sm">{section.summary}</p>
                  )}
                </div>
                <div className="bg-popover divide-y rounded-lg border">
                  {group.map((board) => (
                    <div
                      key={board.id}
                      className={`flex min-w-0 items-center gap-3 p-4 ${board.parentId ? "pl-8" : ""}`}
                    >
                      <MessageSquare
                        aria-hidden
                        className="hidden h-6 w-6 shrink-0 text-orange-600 sm:block"
                      />
                      <div className="min-w-0 flex-1">
                        {board.permissions.read ? (
                          <Link
                            href={`/forum/${board.id}`}
                            className="font-semibold hover:underline"
                          >
                            {board.name}
                          </Link>
                        ) : (
                          <span className="font-semibold">
                            {board.name} (restricted)
                          </span>
                        )}
                        {board.archived && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            Archived
                          </span>
                        )}
                        <p className="text-muted-foreground mt-1 line-clamp-2 text-sm leading-relaxed">
                          {board.summary}
                        </p>
                      </div>
                      <div className="text-muted-foreground shrink-0 text-right text-xs">
                        <span className="text-foreground block font-semibold">
                          {board.nThreads} {board.nThreads === 1 ? "topic" : "topics"}
                        </span>
                        <span>
                          {board.nPosts} {board.nPosts === 1 ? "post" : "posts"}
                        </span>
                      </div>
                      {board.permissions.read && (
                        <Link
                          href={`/forum/${board.id}`}
                          aria-label={`Open ${board.name}`}
                          className="hover:bg-accent rounded-md p-2"
                        >
                          <ChevronRight className="h-5 w-5" />
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          {boards.length === 0 && (
            <p className="text-muted-foreground p-8 text-center">
              No boards are available yet.
            </p>
          )}
        </div>
      )}
      {view !== "boards" && view !== "alerts" && (
        <>
          <details className="mb-4 rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Filter discussions
              {params.get("tag") ? ` tagged “${params.get("tag")}”` : ""}
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Board
                <select
                  className="bg-background block h-10 w-full rounded-md border px-2"
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                >
                  <option value="">All readable boards</option>
                  {boards
                    ?.filter((b) => b.permissions.read)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm" htmlFor={`${fieldPrefix}-1`}>
                Post author
                <Input
                  id={`${fieldPrefix}-1`}
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  maxLength={100}
                />
              </label>
              <label className="text-sm" htmlFor={`${fieldPrefix}-2`}>
                Active since
                <Input
                  id={`${fieldPrefix}-2`}
                  type="date"
                  value={since}
                  onChange={(e) => setSince(e.target.value)}
                />
              </label>
              <label className="text-sm" htmlFor={`${fieldPrefix}-3`}>
                Active until
                <Input
                  id={`${fieldPrefix}-3`}
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </label>
            </div>
          </details>
          {topics.isPending ? (
            <Loader explanation="Finding discussions…" />
          ) : topics.error ? (
            <p role="alert">
              Search could not load.{" "}
              <Button onClick={() => void topics.refetch()}>Try again</Button>
            </p>
          ) : (
            <ForumTopicList
              threads={topics.data?.pages.flatMap((p) => p.threads) ?? []}
            />
          )}
          {topics.hasNextPage && (
            <Button
              className="mt-4 w-full"
              variant="outline"
              disabled={topics.isFetchingNextPage}
              onClick={() => void topics.fetchNextPage()}
            >
              {topics.isFetchingNextPage ? "Loading…" : "Load more discussions"}
            </Button>
          )}
        </>
      )}
      {view === "alerts" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Watched activity</h2>
            <Button
              variant="outline"
              size="sm"
              disabled={readAlerts.isPending}
              onClick={() => readAlerts.mutate()}
            >
              Mark alerts as read
            </Button>
          </div>
          {alerts.isPending ? (
            <Loader explanation="Loading alerts…" />
          ) : !alerts.data?.length ? (
            <div className="rounded-lg border p-8 text-center">
              <Bell className="mx-auto mb-3 h-6 w-6" />
              <p>No alerts yet. Watch a board or topic to hear about new posts.</p>
            </div>
          ) : (
            alerts.data.map((a) => (
              <Link
                key={a.id}
                href={`/forum/${a.boardId}/${a.threadId}?post=${a.postId}`}
                className={`block rounded-md border p-4 ${!a.readAt ? "border-orange-400" : ""}`}
              >
                <span className="font-semibold">{a.title}</span>
                <p className="text-muted-foreground text-xs" suppressHydrationWarning>
                  {a.createdAt.toLocaleString()}
                </p>
              </Link>
            ))
          )}
        </div>
      )}
    </ContentBox>
  );
}

const forumTextFilters = defineFilteringSchema({
  fields: [
    { id: "author", label: "Post author", type: "text", defaultValue: "" },
    { id: "since", label: "Active since", type: "date", defaultValue: "" },
    { id: "until", label: "Active until", type: "date", defaultValue: "" },
  ] as const,
});
