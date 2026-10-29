"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";

/** Present scoped activity and current backlog; period changes retain explicit loading and retry feedback. */
export function ForumAnalytics() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const metrics = api.forum.analytics.useQuery({ days });
  const boards = metrics.data?.boards ?? [];
  const total = (
    key: "topics" | "posts" | "unanswered" | "pending" | "pendingPosts" | "reported",
  ) => boards.reduce((sum, b) => sum + b[key], 0);
  const maximum = Math.max(1, ...(metrics.data?.daily.map((d) => d.posts) ?? []));
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg">Community health</h2>
          <p className="text-xs text-muted-foreground">
            Participation and demand in the boards you moderate.
          </p>
        </div>
        <fieldset className="flex gap-2" aria-label="Analytics period">
          {([7, 30, 90] as const).map((period) => (
            <Button
              key={period}
              size="sm"
              variant={days === period ? "default" : "outline"}
              onClick={() => setDays(period)}
            >
              {period} days
            </Button>
          ))}
        </fieldset>
      </div>
      {metrics.isPending ? (
        <Loader explanation="Loading forum metrics…" />
      ) : metrics.error ? (
        <p role="alert">
          Metrics could not load.{" "}
          <Button onClick={() => void metrics.refetch()}>Try again</Button>
        </p>
      ) : !metrics.data ? (
        <p>You do not have access to forum analytics.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["New topics", total("topics")],
              ["Published posts", total("posts")],
              ["Unanswered questions", total("unanswered")],
              ["Awaiting approval", total("pendingPosts")],
            ].map(([label, value]) => (
              <div className="rounded-lg border bg-popover p-4" key={label}>
                <span className="text-2xl font-semibold tabular-nums">{value}</span>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Topics, posts, participants and staff actions cover the selected period.
            Unanswered questions and moderation counts show the current backlog. Pending
            topic opening posts are also included in pending posts.
          </p>
          <div className="rounded-lg border p-4">
            <h3 className="font-semibold">Published activity</h3>
            {!metrics.data.daily.length ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No published posts in this period.
              </p>
            ) : (
              <section
                className="mt-3 space-y-1 max-h-64 overflow-y-auto"
                aria-label="Posts per day"
              >
                {metrics.data.daily.map((day) => (
                  <div key={day.date} className="flex items-center gap-3 text-xs">
                    <span className="w-24 shrink-0">{day.date}</span>
                    <div aria-hidden className="h-3 flex-1 rounded bg-muted">
                      <div
                        className="h-3 rounded bg-primary"
                        style={{ width: `${(day.posts / maximum) * 100}%` }}
                      />
                    </div>
                    <span className="w-12 text-right tabular-nums">
                      {day.posts} posts
                    </span>
                  </div>
                ))}
              </section>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <caption className="p-3 text-left font-semibold">
                Board participation & backlog
              </caption>
              <thead className="bg-muted text-left text-xs">
                <tr>
                  {[
                    "Board",
                    "New topics",
                    "Posts",
                    "Participants",
                    "Unanswered",
                    "Pending posts",
                    "Reported",
                    "Removed posts",
                  ].map((label) => (
                    <th className="p-3" key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {boards.map((board) => (
                  <tr key={board.id} className="border-t">
                    <th scope="row" className="p-3 text-left font-medium">
                      <Link href={`/forum/${board.id}`} className="underline">
                        {board.name}
                      </Link>
                    </th>
                    {[
                      board.topics,
                      board.posts,
                      board.participants,
                      board.unanswered,
                      board.pendingPosts,
                      board.reported,
                      board.removedPosts,
                    ].map((value, i) => (
                      <td key={`${board.id}-${i}`} className="p-3 tabular-nums">
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-lg border p-4">
            <h3 className="font-semibold">Staff workload</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Recorded forum actions in this period; this is a workload indicator, not a
              staff performance score.
            </p>
            {!metrics.data.reviewers.length ? (
              <p className="text-sm text-muted-foreground">
                No staff actions in this period.
              </p>
            ) : (
              <ul className="divide-y">
                {metrics.data.reviewers.map((reviewer) => (
                  <li
                    className="flex justify-between gap-4 py-2 text-sm"
                    key={reviewer.actorId}
                  >
                    <span>{reviewer.username ?? "Former player"}</span>
                    <span className="tabular-nums">{reviewer.actions} actions</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
