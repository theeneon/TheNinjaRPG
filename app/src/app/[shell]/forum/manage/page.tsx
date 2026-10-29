"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import ContentBox from "@/layout/ContentBox";
import { ForumNavigation } from "@/layout/Forum";
import { ForumAnalytics } from "@/layout/ForumAnalytics";
import { ForumTopicTools } from "@/layout/ForumModeration";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import { parseHtml } from "@/utils/parse";
import { addDays } from "@/utils/time";
import { useUserData } from "@/utils/UserContext";
import {
  type ForumPolicy,
  forumAudiences,
  forumCapabilities,
  forumSectionSchema,
  forumStructureBoardSchema,
} from "@/validators/forum";
import { getSearchValidator } from "@/validators/register";

/** Load one scoped staff workspace and retain independent review, structure, access and audit views. */
export default function ForumManagement() {
  const fieldPrefix = useId();
  const { data: user } = useUserData();
  const [tab, setTab] = useState("review");
  const [query, setQuery] = useState("");
  const [reviewPage, setReviewPage] = useState(0);
  const debouncedQuery = useDebouncedValue(query);
  const data = api.forum.administration.useQuery(
    { query: debouncedQuery, reviewPage },
    { enabled: !!user, placeholderData: (previous) => previous },
  );
  const utils = api.useUtils();
  const refresh = async () => {
    await Promise.all([
      utils.forum.invalidate(),
      utils.comments.getForumComments.invalidate(),
    ]);
  };
  return (
    <ContentBox
      title="Forum staff workspace"
      subtitle="Manage discussions, community access and forum structure."
      defaultBackHref="/forum"
      topRightCorntentBreakpoint="sm"
      topRightContent={<ForumNavigation />}
    >
      {!user ? (
        <p>Sign in with a forum staff account to continue.</p>
      ) : data.isPending ? (
        <Loader explanation="Loading staff workspace…" />
      ) : data.error ? (
        <p role="alert">
          The workspace could not load.{" "}
          <Button onClick={() => void data.refetch()}>Try again</Button>
          {query && (
            <Button variant="outline" onClick={() => setQuery("")}>
              Clear search
            </Button>
          )}
        </p>
      ) : !data.data ? (
        <p>You do not have permission to manage this forum.</p>
      ) : (
        <>
          <nav
            aria-label="Staff tools"
            className="mb-4 flex flex-wrap gap-2 border-b pb-3"
          >
            {[
              ["review", "Review & recovery"],
              ...(data.data.canManage
                ? [
                    ["structure", "Sections & boards"],
                    ["staff", "Staff & permissions"],
                  ]
                : []),
              ...(data.data.canManage ||
              data.data.boards.some((b) => b.permissions.moderate)
                ? [["restrictions", "Posting restrictions"]]
                : []),
              ["logs", "Audit log"],
              ...(data.data.canManage ||
              data.data.boards.some((b) => b.permissions.moderate)
                ? [["analytics", "Community analytics"]]
                : []),
            ].map(([key, label]) => (
              <Button
                key={key}
                variant={tab === key ? "default" : "outline"}
                size="sm"
                onClick={() => setTab(key ?? "review")}
              >
                {label}
              </Button>
            ))}
          </nav>
          {tab === "structure" && <ForumStructure data={data.data} refresh={refresh} />}
          {tab === "staff" && <ForumStaff data={data.data} refresh={refresh} />}
          {tab === "restrictions" && (
            <ForumRestrictions data={data.data} refresh={refresh} />
          )}
          {tab === "review" && (
            <>
              <nav aria-label="Review pages" className="mb-4 flex items-center gap-3">
                <Button
                  variant="outline"
                  disabled={reviewPage === 0 || data.isFetching}
                  onClick={() => setReviewPage((page) => page - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm">Page {reviewPage + 1}</span>
                <Button
                  variant="outline"
                  disabled={!data.data.hasMoreReviews || data.isFetching}
                  onClick={() => setReviewPage((page) => page + 1)}
                >
                  Next
                </Button>
              </nav>
              {data.isPlaceholderData ? (
                <Loader explanation="Loading review page…" />
              ) : (
                <ForumReview key={reviewPage} data={data.data} refresh={refresh} />
              )}
            </>
          )}
          {tab === "analytics" && <ForumAnalytics />}
          {tab === "logs" && (
            <div className="space-y-3">
              <label className="block text-sm" htmlFor={`${fieldPrefix}-1`}>
                Find an action, reason, player or target
                <Input
                  id={`${fieldPrefix}-1`}
                  placeholder="Search the audit log"
                  maxLength={200}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <p className="text-muted-foreground text-xs">
                Showing up to 100 recent matching actions.
              </p>
              {data.data.logs.length === 0 ? (
                <p className="rounded-md border p-6 text-sm">
                  No matching moderation actions.
                </p>
              ) : (
                data.data.logs.map((log) => (
                  <details key={log.id} className="rounded-md border p-3">
                    <summary className="cursor-pointer text-sm break-words">
                      <b>{log.action.replaceAll(".", " · ").replaceAll("_", " ")}</b> ·{" "}
                      {log.reason}
                      <span
                        className="text-muted-foreground mt-1 block text-xs"
                        suppressHydrationWarning
                      >
                        {log.createdAt.toLocaleString()} ·{" "}
                        {log.actorName ?? "Former player"}
                      </span>
                    </summary>
                    <div className="mt-3 text-xs">
                      <p>Target: {log.targetId}</p>
                      <pre className="bg-muted mt-2 max-h-80 overflow-auto rounded p-3 break-all whitespace-pre-wrap">
                        {JSON.stringify(
                          { before: log.before, after: log.after },
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  </details>
                ))
              )}
            </div>
          )}
        </>
      )}
    </ContentBox>
  );
}

/** Navigate the stable section/board hierarchy and focus newly opened configuration forms. */
function ForumStructure({
  data,
  refresh,
}: {
  data: Administration;
  refresh: () => Promise<void>;
}) {
  const [edit, setEdit] = useState<{ type: "section" | "board"; id?: string } | null>(
    null,
  );
  const [remove, setRemove] = useState<{
    type: "BOARD" | "SECTION";
    id: string;
  } | null>(null);
  const editRef = useRef<HTMLDivElement>(null);
  const removeRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!edit) return;
    const form = editRef.current;
    form?.querySelector<HTMLHeadingElement>("h2")?.focus({ preventScroll: true });
    form?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [edit]);
  useEffect(() => {
    if (!remove) return;
    const form = removeRef.current;
    form?.focus({ preventScroll: true });
    form?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [remove]);
  const repair = api.forum.repairCounters.useMutation({
    onSuccess: async (r) => {
      showMutationToast(r);
      if (r.success) await refresh();
    },
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setEdit({ type: "section" })}>New section</Button>
        <Button
          variant="outline"
          onClick={() => setEdit({ type: "board" })}
          disabled={!data.sections.length}
        >
          New board
        </Button>
      </div>
      {edit && (
        <div ref={editRef} className="scroll-mt-6">
          {edit.type === "section" && (
            <SectionEditor
              key={edit.id ?? "new-section"}
              section={data.sections.find((s) => s.id === edit.id)}
              done={() => {
                setEdit(null);
                void refresh();
              }}
            />
          )}
          {edit.type === "board" && (
            <BoardEditor
              key={edit.id ?? "new-board"}
              board={data.boards.find((b) => b.id === edit.id)}
              data={data}
              done={() => {
                setEdit(null);
                void refresh();
              }}
            />
          )}
        </div>
      )}
      {remove && (
        <section
          ref={removeRef}
          tabIndex={-1}
          aria-label="Remove container"
          className="focus-visible:outline-ring scroll-mt-6 rounded-lg focus-visible:outline focus-visible:outline-2"
        >
          <RemoveStructure
            key={remove.id}
            target={remove}
            data={data}
            done={() => {
              setRemove(null);
              void refresh();
            }}
          />
        </section>
      )}
      {data.sections.map((section) => (
        <section key={section.id} className="overflow-hidden rounded-lg border">
          <div className="bg-muted/40 flex flex-wrap items-center gap-2 p-4">
            <div className="mr-auto">
              <h2 className="font-semibold">
                {section.name}
                {section.archived && " (archived)"}
              </h2>
              <p className="text-muted-foreground text-xs">
                {data.boards.filter((b) => b.sectionId === section.id).length} boards ·
                position {section.position}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEdit({ type: "section", id: section.id })}
            >
              Edit section
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRemove({ type: "SECTION", id: section.id })}
            >
              Remove container
            </Button>
          </div>
          <div className="divide-y">
            {data.boards
              .filter((b) => b.sectionId === section.id)
              .map((board) => (
                <div key={board.id} className="flex flex-wrap items-center gap-2 p-4">
                  <div className="mr-auto min-w-0">
                    <Link
                      href={`/forum/${board.id}`}
                      className="font-medium hover:underline"
                    >
                      {board.name}
                    </Link>
                    {board.archived && <span className="ml-2 text-xs">Archived</span>}
                    <p className="text-muted-foreground text-xs">
                      {board.nThreads} topics · {board.nPosts} posts · position{" "}
                      {board.position}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEdit({ type: "board", id: board.id })}
                  >
                    Edit board
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={repair.isPending}
                    onClick={() => repair.mutate({ boardId: board.id })}
                  >
                    Recount
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRemove({ type: "BOARD", id: board.id })}
                  >
                    Remove container
                  </Button>
                </div>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
/** Save shared section defaults with an audit reason; close the editor only after success. */
function SectionEditor({
  section,
  done,
}: {
  section?: Administration["sections"][number];
  done: () => void;
}) {
  const fieldPrefix = useId();
  const [values, setValues] = useState<z.infer<typeof forumSectionSchema>>({
    id: section?.id,
    name: section?.name ?? "",
    summary: section?.summary ?? "",
    position: section?.position ?? 0,
    archived: section?.archived ?? false,
    policy: section?.policy ?? {},
    reason: "",
  });
  const [error, setError] = useState("");
  const save = api.forum.saveSection.useMutation();
  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = forumSectionSchema.safeParse(values);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Check the form");
          return;
        }
        try {
          const result = await save.mutateAsync(parsed.data);
          showMutationToast(result);
          if (result.success) done();
          else setError(result.message);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Section could not be saved");
        }
      }}
    >
      <h2
        tabIndex={-1}
        className="focus-visible:outline-ring rounded-sm font-semibold focus-visible:outline focus-visible:outline-2"
      >
        {section ? "Edit section" : "New section"}
      </h2>
      <label className="block text-sm" htmlFor={`${fieldPrefix}-2`}>
        Name
        <Input
          id={`${fieldPrefix}-2`}
          value={values.name}
          required
          minLength={2}
          maxLength={100}
          onChange={(e) =>
            setValues((current) => ({ ...current, name: e.target.value }))
          }
        />
      </label>
      <label className="block text-sm" htmlFor={`${fieldPrefix}-3`}>
        Description
        <Textarea
          id={`${fieldPrefix}-3`}
          value={values.summary}
          onChange={(e) =>
            setValues((current) => ({ ...current, summary: e.target.value }))
          }
          maxLength={1000}
        />
      </label>
      <label className="block text-sm" htmlFor={`${fieldPrefix}-4`}>
        Position
        <NumberInput
          id={`${fieldPrefix}-4`}
          value={values.position}
          min={0}
          max={10000}
          onValueChange={(position) =>
            setValues((current) => ({ ...current, position }))
          }
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.archived}
          onChange={(e) =>
            setValues((current) => ({ ...current, archived: e.target.checked }))
          }
        />
        Archive section (keep its discussions readable)
      </label>
      <PolicyEditor
        policy={values.policy}
        onChange={(policy) => setValues((current) => ({ ...current, policy }))}
      />
      <Reason
        value={values.reason}
        setValue={(reason) => setValues((current) => ({ ...current, reason }))}
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save section"}
        </Button>
        <Button type="button" variant="ghost" onClick={done}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
/** Edit board overrides and hierarchy through shared validators; inherited settings stay explicit. */
function BoardEditor({
  board,
  data,
  done,
}: {
  board?: Administration["boards"][number];
  data: Administration;
  done: () => void;
}) {
  const fieldPrefix = useId();
  const [values, setValues] = useState<z.infer<typeof forumStructureBoardSchema>>({
    id: board?.id,
    sectionId: board?.sectionId ?? data.sections[0]?.id ?? "",
    parentId: board?.parentId ?? null,
    name: board?.name ?? "",
    summary: board?.summary ?? "",
    rules: board?.rules ?? "",
    position: board?.position ?? 0,
    archived: board?.archived ?? false,
    policy: board?.policy ?? {},
    slowModeSeconds: board?.slowModeSeconds ?? 0,
    requireApproval: board?.requireApproval ?? false,
    reason: "",
  });
  const [error, setError] = useState("");
  const save = api.forum.saveBoard.useMutation();
  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = forumStructureBoardSchema.safeParse(values);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Check the form");
          return;
        }
        try {
          const result = await save.mutateAsync(parsed.data);
          showMutationToast(result);
          if (result.success) done();
          else setError(result.message);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Board could not be saved");
        }
      }}
    >
      <h2
        tabIndex={-1}
        className="focus-visible:outline-ring rounded-sm font-semibold focus-visible:outline focus-visible:outline-2"
      >
        {board ? "Edit board" : "New board"}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm" htmlFor={`${fieldPrefix}-5`}>
          Name
          <Input
            id={`${fieldPrefix}-5`}
            value={values.name}
            required
            minLength={2}
            maxLength={100}
            onChange={(e) =>
              setValues((current) => ({ ...current, name: e.target.value }))
            }
          />
        </label>
        <label className="text-sm">
          Section
          <select
            className="bg-background block h-10 w-full rounded-md border px-2"
            value={values.sectionId}
            onChange={(e) =>
              setValues((current) => ({
                ...current,
                sectionId: e.target.value,
                parentId: null,
              }))
            }
          >
            {data.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Parent board
          <select
            className="bg-background block h-10 w-full rounded-md border px-2"
            value={values.parentId ?? ""}
            onChange={(e) =>
              setValues((current) => ({ ...current, parentId: e.target.value || null }))
            }
          >
            <option value="">No parent board</option>
            {data.boards
              .filter((b) => b.id !== board?.id && b.sectionId === values.sectionId)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm" htmlFor={`${fieldPrefix}-6`}>
          Position
          <NumberInput
            id={`${fieldPrefix}-6`}
            min={0}
            max={10000}
            value={values.position}
            onValueChange={(position) =>
              setValues((current) => ({ ...current, position }))
            }
          />
        </label>
      </div>
      <label className="block text-sm" htmlFor={`${fieldPrefix}-7`}>
        Description
        <Textarea
          id={`${fieldPrefix}-7`}
          value={values.summary}
          maxLength={2000}
          onChange={(e) =>
            setValues((current) => ({ ...current, summary: e.target.value }))
          }
        />
      </label>
      <label className="block text-sm" htmlFor={`${fieldPrefix}-8`}>
        Board rules
        <Textarea
          id={`${fieldPrefix}-8`}
          value={values.rules}
          maxLength={5000}
          onChange={(e) =>
            setValues((current) => ({ ...current, rules: e.target.value }))
          }
        />
      </label>
      <label className="block text-sm" htmlFor={`${fieldPrefix}-9`}>
        Seconds between replies (0 disables slow mode)
        <NumberInput
          id={`${fieldPrefix}-9`}
          min={0}
          max={86400}
          value={values.slowModeSeconds}
          onValueChange={(slowModeSeconds) =>
            setValues((current) => ({ ...current, slowModeSeconds }))
          }
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.requireApproval}
          onChange={(e) =>
            setValues((current) => ({ ...current, requireApproval: e.target.checked }))
          }
        />
        Require staff approval before publishing new posts
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.archived}
          onChange={(e) =>
            setValues((current) => ({ ...current, archived: e.target.checked }))
          }
        />
        Archive board (keep discussions readable)
      </label>
      <PolicyEditor
        policy={values.policy}
        onChange={(policy) => setValues((current) => ({ ...current, policy }))}
      />
      <Reason
        value={values.reason}
        setValue={(reason) => setValues((current) => ({ ...current, reason }))}
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save board"}
        </Button>
        <Button type="button" variant="ghost" onClick={done}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
/** Distinguish inherited audience rules from explicit denial and per-board author capabilities. */
function PolicyEditor({
  policy,
  onChange,
}: {
  policy: ForumPolicy;
  onChange: (p: ForumPolicy) => void;
}) {
  return (
    <fieldset className="rounded-md border p-3">
      <legend className="px-1 text-sm font-semibold">Access policy</legend>
      <p className="text-muted-foreground mb-3 text-xs">
        Inherit uses the parent board, then section policy. Forum staff grants are
        evaluated separately; explicit denies override grants.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["view", "read", "create", "reply", "upload", "vote"] as const).map((key) => (
          <label key={key} className="text-sm">
            {
              {
                view: "See board",
                read: "Read topics",
                create: "Create topics",
                reply: "Reply",
                upload: "Embed media",
                vote: "React & vote",
              }[key]
            }
            <select
              className="bg-background block h-10 w-full rounded-md border px-2"
              value={policy[key] ?? ""}
              onChange={(e) => {
                const next = { ...policy };
                if (e.target.value)
                  next[key] = e.target.value as NonNullable<ForumPolicy[typeof key]>;
                else delete next[key];
                onChange(next);
              }}
            >
              <option value="">Inherit</option>
              {forumAudiences.map((a) => (
                <option key={a} value={a}>
                  {
                    {
                      PUBLIC: "Everyone",
                      MEMBERS: "Registered players",
                      STAFF: "Game staff",
                      MODERATORS: "Forum moderators",
                      NONE: "Nobody (explicit grants only)",
                    }[a]
                  }
                </option>
              ))}
            </select>
          </label>
        ))}
        {(["editOwn", "deleteOwn"] as const).map((key) => (
          <label key={key} className="text-sm">
            {key === "editOwn" ? "Edit own posts" : "Remove own posts"}
            <select
              className="bg-background block h-10 w-full rounded-md border px-2"
              value={policy[key] === undefined ? "" : String(policy[key])}
              onChange={(e) => {
                const next = { ...policy };
                if (e.target.value) next[key] = e.target.value === "true";
                else delete next[key];
                onChange(next);
              }}
            >
              <option value="">Inherit</option>
              <option value="true">Allow</option>
              <option value="false">Deny</option>
            </select>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
/** Require a destination for retained content and surface recoverable server rejections in place. */
function RemoveStructure({
  target,
  data,
  done,
}: {
  target: { type: "BOARD" | "SECTION"; id: string };
  data: Administration;
  done: () => void;
}) {
  const [destinationId, setDestination] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const mutation = api.forum.removeStructure.useMutation();
  const source = (target.type === "BOARD" ? data.boards : data.sections).find(
    (s) => s.id === target.id,
  );
  const count =
    target.type === "BOARD"
      ? (data.boards.find((b) => b.id === target.id)?.nThreads ?? 0)
      : data.boards.filter((b) => b.sectionId === target.id).length;
  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const result = await mutation.mutateAsync({
            ...target,
            destinationId: destinationId || undefined,
            reason,
          });
          showMutationToast(result);
          if (result.success) done();
          else setError(result.message);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Container could not be removed");
        }
      }}
    >
      <h2 className="font-semibold">Remove {source?.name}</h2>
      <p className="text-sm">
        This contains {count} {target.type === "BOARD" ? "visible topics" : "boards"}.
        Choose where to move its content. Archive from the edit form to keep the
        container and its history.
      </p>
      <label className="block text-sm">
        Destination
        <select
          className="bg-background block h-10 w-full rounded-md border px-2"
          value={destinationId}
          onChange={(e) => setDestination(e.target.value)}
        >
          <option value="">Remove only if empty</option>
          {(target.type === "BOARD" ? data.boards : data.sections)
            .filter((s) => s.id !== target.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </label>
      <Reason value={reason} setValue={setReason} />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={mutation.isPending || reason.trim().length < 3}>
          Move content and remove container
        </Button>
        <Button type="button" variant="ghost" onClick={done}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
/** Adapt the existing player picker to the staff forms without exposing raw account identifiers. */
function ForumPlayerSelect({ onSelect }: { onSelect: (id: string) => void }) {
  const schema = getSearchValidator({ max: 1 });
  const form = useForm<z.infer<typeof schema>>({
    defaultValues: { username: "", users: [] },
  });
  const selected = useWatch({ control: form.control, name: "users" });
  return (
    <div className="space-y-2">
      <UserSearchSelect useFormMethods={form} showYourself showAi maxUsers={1} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!selected?.[0]}
        onClick={() => {
          const id = selected?.[0]?.userId;
          if (id) onSelect(id);
        }}
      >
        Use selected player
      </Button>
    </div>
  );
}
/** Manage scoped grants/denies and inspect the resulting effective permissions for a selected player. */
function ForumStaff({
  data,
  refresh,
}: {
  data: Administration;
  refresh: () => Promise<void>;
}) {
  const [userId, setUserId] = useState("");
  const [scope, setScope] = useState<"GLOBAL" | "SECTION" | "BOARD">("BOARD");
  const [scopeId, setScopeId] = useState(data.boards[0]?.id ?? "");
  const [permissions, setPermissions] = useState<(typeof forumCapabilities)[number][]>([
    "moderate",
    "approve",
  ]);
  const [denies, setDenies] = useState<(typeof forumCapabilities)[number][]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const save = api.forum.saveGrant.useMutation();
  const effective = api.forum.effectivePermissions.useQuery(
    { userId },
    { enabled: !!userId },
  );
  return (
    <div className="space-y-4">
      <form
        className="space-y-3 rounded-lg border p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            const result = await save.mutateAsync({
              userId,
              scope,
              scopeId: scope === "GLOBAL" ? "*" : scopeId,
              permissions,
              denies,
              reason,
              remove: false,
            });
            showMutationToast(result);
            if (result.success) {
              setReason("");
              await refresh();
            } else setError(result.message);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Permissions could not be saved");
          }
        }}
      >
        <h2 className="font-semibold">Assign forum capabilities</h2>
        <ForumPlayerSelect onSelect={setUserId} />
        {userId && (
          <p className="text-sm">
            Selected: {effective.data?.username ?? "Loading player…"}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Scope
            <select
              className="bg-background block h-10 w-full rounded-md border px-2"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as typeof scope);
                if (e.target.value !== "GLOBAL") {
                  const isScoped = (capability: string) =>
                    !["manage", "purge"].includes(capability);
                  setPermissions((current) => current.filter(isScoped));
                  setDenies((current) => current.filter(isScoped));
                }
                setScopeId(
                  e.target.value === "SECTION"
                    ? (data.sections[0]?.id ?? "")
                    : (data.boards[0]?.id ?? ""),
                );
              }}
            >
              <option value="BOARD">Board</option>
              <option value="SECTION">Section</option>
              <option value="GLOBAL">Whole forum</option>
            </select>
          </label>
          {scope !== "GLOBAL" && (
            <label className="text-sm">
              Location
              <select
                className="bg-background block h-10 w-full rounded-md border px-2"
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
              >
                {(scope === "BOARD" ? data.boards : data.sections).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">Capability</th>
                <th className="p-2">Grant</th>
                <th className="p-2">Deny</th>
              </tr>
            </thead>
            <tbody>
              {forumCapabilities
                .filter((c) => scope === "GLOBAL" || !["manage", "purge"].includes(c))
                .map((cap) => (
                  <tr key={cap} className="border-t">
                    <td className="p-2">{capabilityLabel(cap)}</td>
                    <td className="p-2">
                      <input
                        type="checkbox"
                        aria-label={`Grant ${capabilityLabel(cap)}`}
                        checked={permissions.includes(cap)}
                        onChange={(e) =>
                          setPermissions((p) =>
                            e.target.checked ? [...p, cap] : p.filter((c) => c !== cap),
                          )
                        }
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="checkbox"
                        aria-label={`Deny ${capabilityLabel(cap)}`}
                        checked={denies.includes(cap)}
                        onChange={(e) =>
                          setDenies((p) =>
                            e.target.checked ? [...p, cap] : p.filter((c) => c !== cap),
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Reason value={reason} setValue={setReason} />
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button disabled={!userId || save.isPending || reason.trim().length < 3}>
          Save capabilities
        </Button>
      </form>
      {effective.data && (
        <details className="rounded-lg border p-4" open>
          <summary className="cursor-pointer font-semibold">
            Effective access for {effective.data.username}
          </summary>
          <p className="text-muted-foreground my-2 text-xs">
            Board policy inherits from its section. Explicit scoped denies win; posting
            restrictions and account state can further limit actions. Site
            administrators keep recovery access.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Board</th>
                  <th className="p-2">Effective capabilities</th>
                </tr>
              </thead>
              <tbody>
                {effective.data.boards.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="p-2">{b.name}</td>
                    <td className="p-2">
                      {Object.entries(b.permissions)
                        .filter(([key, value]) => value === true && key !== "archived")
                        .map(([key]) => capabilityLabel(key, true))
                        .join(", ") || "No access"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <h2 className="font-semibold">Explicit assignments</h2>
      {data.grants.map((g) => (
        <div
          key={g.id}
          className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
        >
          <div className="mr-auto min-w-0 break-words">
            <b>{g.user?.username ?? g.userId}</b>
            <p>
              {g.scope === "GLOBAL"
                ? "Whole forum"
                : (g.scope === "BOARD" ? data.boards : data.sections).find(
                    (s) => s.id === g.scopeId,
                  )?.name}{" "}
              · {g.permissions.map((cap) => capabilityLabel(cap)).join(", ")}
            </p>
            {!!g.denies.length && (
              <p>Deny: {g.denies.map((cap) => capabilityLabel(cap)).join(", ")}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={save.isPending}
            onClick={async () => {
              setError("");
              try {
                const result = await save.mutateAsync({
                  ...g,
                  remove: true,
                  reason: "Remove forum assignment",
                });
                showMutationToast(result);
                if (result.success) await refresh();
                else setError(result.message);
              } catch (error) {
                const message =
                  error instanceof Error
                    ? error.message
                    : "Assignment could not be removed";
                setError(message);
              }
            }}
          >
            Remove assignment
          </Button>
        </div>
      ))}
    </div>
  );
}
/** Apply or lift forum-only posting restrictions while retaining inputs after rejected attempts. */
function ForumRestrictions({
  data,
  refresh,
}: {
  data: Administration;
  refresh: () => Promise<void>;
}) {
  const fieldPrefix = useId();
  const [userId, setUserId] = useState("");
  const restrictable = data.boards.filter(
    (board) => data.canManage || board.permissions.moderate,
  );
  const [boardId, setBoardId] = useState(
    data.canManage ? "" : (restrictable[0]?.id ?? ""),
  );
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const save = api.forum.restrict.useMutation();
  return (
    <div className="space-y-4">
      <form
        className="space-y-3 rounded-lg border p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            const r = await save.mutateAsync({
              userId,
              boardId: boardId || null,
              expiresAt: addDays(new Date(), days),
              reason,
              remove: false,
            });
            showMutationToast(r);
            if (r.success) await refresh();
            else setError(r.message);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Restriction could not be saved");
          }
        }}
      >
        <h2 className="font-semibold">Temporarily restrict forum posting</h2>
        <p className="text-muted-foreground text-sm">
          The player can read permitted boards. Their game account remains active.
        </p>
        <ForumPlayerSelect onSelect={setUserId} />
        <label className="block text-sm">
          Scope
          <select
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
            className="bg-background block h-10 w-full rounded-md border px-2"
          >
            {data.canManage && <option value="">Whole forum</option>}
            {restrictable.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm" htmlFor={`${fieldPrefix}-10`}>
          Duration in days
          <NumberInput
            id={`${fieldPrefix}-10`}
            value={days}
            min={1}
            max={90}
            onValueChange={setDays}
          />
        </label>
        <Reason value={reason} setValue={setReason} />
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button disabled={!userId || save.isPending || reason.trim().length < 3}>
          Restrict posting
        </Button>
      </form>
      <h2 className="font-semibold">Restrictions</h2>
      {!data.restrictions.length && (
        <p className="text-muted-foreground text-sm">No restrictions in your scope.</p>
      )}
      {data.restrictions.map((r) => (
        <div
          key={r.id}
          className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
        >
          <div className="mr-auto">
            <b>{r.user?.username ?? r.userId}</b>
            <p>{r.reason}</p>
            <p className="text-muted-foreground text-xs" suppressHydrationWarning>
              {r.boardId
                ? data.boards.find((b) => b.id === r.boardId)?.name
                : "Whole forum"}{" "}
              · expires {r.expiresAt.toLocaleString()}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={save.isPending}
            onClick={async () => {
              setError("");
              try {
                const result = await save.mutateAsync({ ...r, remove: true });
                showMutationToast(result);
                if (result.success) await refresh();
                else setError(result.message);
              } catch (error) {
                const message =
                  error instanceof Error
                    ? error.message
                    : "Restriction could not be lifted";
                setError(message);
              }
            }}
          >
            Lift restriction
          </Button>
        </div>
      ))}
    </div>
  );
}
/** Review only the returned staff scope, expanding evidence in place and preserving retryable decisions. */
function ForumReview({
  data,
  refresh,
}: {
  data: Administration;
  refresh: () => Promise<void>;
}) {
  const { data: user } = useUserData();
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const reviewCase = api.forum.reviewCase.useMutation();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const moderate = api.forum.moderatePost.useMutation();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm">
          {data.threads.length} topics and {data.posts.length} posts need review or can
          be recovered.
        </p>
        <Link
          href="/reports"
          className="hover:bg-accent rounded-md border px-3 py-2 text-sm"
        >
          Open linked report workflow
        </Link>
      </div>
      <p className="text-muted-foreground text-xs">
        Reports keep their existing evidence, decisions and game enforcement workflow.
        Forum restrictions are managed separately here. Each page shows up to 100 topics
        and 100 posts.
      </p>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Choose a reviewer
        </summary>
        <ForumPlayerSelect onSelect={setAssigneeId} />
      </details>
      <Reason value={reason} setValue={setReason} />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <h2 className="font-semibold">Topics</h2>
      {selected.length > 0 && (
        <ForumTopicTools
          ids={selected}
          onlyApprove={
            !selected.every(
              (id) =>
                data.boards.find(
                  (b) => b.id === data.threads.find((t) => t.id === id)?.boardId,
                )?.permissions.moderate,
            )
          }
          onDone={() => {
            setSelected([]);
          }}
        />
      )}
      {data.threads.map((t) => (
        <label
          key={t.id}
          className="flex items-start gap-3 rounded-md border p-3 text-sm"
        >
          <input
            className="mt-1"
            type="checkbox"
            checked={selected.includes(t.id)}
            onChange={(e) =>
              setSelected((s) =>
                e.target.checked ? [...s, t.id] : s.filter((id) => id !== t.id),
              )
            }
          />
          <span>
            <b>{t.title}</b>
            <span className="text-muted-foreground block text-xs">
              {data.boards.find((b) => b.id === t.boardId)?.name} ·{" "}
              {t.deletedAt ? "Removed" : "Awaiting approval"}
            </span>
          </span>
        </label>
      ))}
      {data.threads
        .filter(
          (t) =>
            t.deletedAt &&
            data.boards.find((b) => b.id === t.boardId)?.permissions.purge,
        )
        .map((t) => (
          <PurgeTopic key={t.id} thread={t} done={refresh} />
        ))}
      {!data.threads.length && (
        <p className="text-muted-foreground text-sm">No topics waiting for review.</p>
      )}
      <h2 className="font-semibold">Posts</h2>
      {data.posts.map(({ post, thread, review, assigneeName }) => (
        <div key={post.id} className="space-y-2 rounded-md border p-4">
          <p className="text-sm">
            <b>{thread.title}</b> ·{" "}
            {post.deletedAt
              ? "Removed"
              : !post.isApproved
                ? "Awaiting approval"
                : "Reported"}
          </p>
          <p className="text-muted-foreground text-xs">
            {review?.status ?? "OPEN"} · {assigneeName ?? "Unassigned"}
            {review?.decision ? ` · ${review.decision}` : ""}
          </p>
          {data.linkedReports
            .filter((r) => r.postId === post.id)
            .map((r) => (
              <Link
                key={r.id}
                href={`/reports/${r.id}`}
                className="inline-block text-xs underline"
              >
                Linked report ({r.status})
              </Link>
            ))}
          <div className="flex flex-wrap gap-2">
            {(data.boards.find((b) => b.id === thread.boardId)?.permissions.moderate
              ? [
                  ["Claim review", user?.userId, "IN_REVIEW"],
                  ...(assigneeId ? [["Assign reviewer", assigneeId, "IN_REVIEW"]] : []),
                  [
                    review?.status === "RESOLVED"
                      ? "Reopen review"
                      : "Resolve forum review",
                    review?.assigneeId ?? user?.userId,
                    review?.status === "RESOLVED" ? "OPEN" : "RESOLVED",
                  ],
                ]
              : []
            ).map(([label, assignee, status]) => (
              <Button
                key={label}
                type="button"
                size="sm"
                variant="outline"
                disabled={reason.trim().length < 3 || reviewCase.isPending}
                onClick={async () => {
                  setError("");
                  try {
                    const result = await reviewCase.mutateAsync({
                      postId: post.id,
                      assigneeId: assignee ?? null,
                      status: status as "OPEN" | "IN_REVIEW" | "RESOLVED",
                      reason,
                    });
                    showMutationToast(result);
                    if (result.success) await refresh();
                    else setError(result.message);
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "Review could not be saved.",
                    );
                  }
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          {post.removalReason && (
            <p className="text-muted-foreground text-xs">
              Removal reason: {post.removalReason}
            </p>
          )}
          <details className="group text-sm">
            <summary aria-label="Read full post" className="cursor-pointer">
              <span className="font-medium">Read full post</span>
              <div className="mt-2 line-clamp-6 break-words group-open:hidden">
                {parseHtml(post.content)}
              </div>
            </summary>
            <div className="mt-2 break-words">{parseHtml(post.content)}</div>
          </details>
          <div className="flex flex-wrap gap-2">
            {[
              ...(post.deletedAt &&
              data.boards.find((b) => b.id === thread.boardId)?.permissions.moderate
                ? ["RESTORE"]
                : []),
              ...(!post.isApproved &&
              thread.isApproved &&
              data.boards.find((b) => b.id === thread.boardId)?.permissions.approve
                ? ["APPROVE"]
                : []),
              ...(post.isReported &&
              data.boards.find((b) => b.id === thread.boardId)?.permissions.moderate
                ? ["DISMISS_REPORT"]
                : []),
              ...(!post.deletedAt &&
              data.boards.find((b) => b.id === thread.boardId)?.permissions.removeOthers
                ? ["REMOVE"]
                : []),
            ].map((action) => (
              <Button
                key={action}
                variant="outline"
                size="sm"
                disabled={reason.trim().length < 3 || moderate.isPending}
                onClick={async () => {
                  setError("");
                  try {
                    const r = await moderate.mutateAsync({
                      postId: post.id,
                      action: action as
                        | "RESTORE"
                        | "APPROVE"
                        | "REMOVE"
                        | "DISMISS_REPORT",
                      reason,
                    });
                    showMutationToast(r);
                    if (r.success) await refresh();
                    else setError(r.message);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Moderation failed");
                  }
                }}
              >
                {action === "RESTORE"
                  ? "Restore post"
                  : action === "APPROVE"
                    ? "Approve post"
                    : action === "REMOVE"
                      ? "Remove post"
                      : "Clear forum flag"}
              </Button>
            ))}
          </div>
        </div>
      ))}
      {!data.posts.length && (
        <p className="text-muted-foreground text-sm">No posts waiting for review.</p>
      )}
    </div>
  );
}
/** Give audit-reason inputs stable accessible labels across independently mounted staff forms. */
function Reason({
  value,
  setValue,
}: {
  value: string;
  setValue: (value: string) => void;
}) {
  const fieldPrefix = useId();
  return (
    <label className="block text-sm" htmlFor={`${fieldPrefix}-11`}>
      Reason for the audit log
      <Input
        id={`${fieldPrefix}-11`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
        minLength={3}
        maxLength={500}
        placeholder="Explain the change"
      />
    </label>
  );
}

/** Gate permanent removal behind explicit permission, exact-title confirmation and an audit reason. */
function PurgeTopic({
  thread,
  done,
}: {
  thread: Administration["threads"][number];
  done: () => Promise<void>;
}) {
  const fieldPrefix = useId();
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const mutation = api.forum.purgeTopic.useMutation();
  return (
    <details className="border-destructive rounded-md border p-3">
      <summary className="text-destructive cursor-pointer text-sm font-semibold">
        Permanently purge “{thread.title}”
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const result = await mutation.mutateAsync({
              threadId: thread.id,
              confirmTitle: title,
              reason,
            });
            showMutationToast(result);
            if (result.success) await done();
            else setError(result.message);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Purge failed.");
          }
        }}
      >
        <p className="text-sm">
          This permanently removes the topic, posts and revisions. The audit record
          remains. This action cannot be undone.
        </p>
        <label htmlFor={`${fieldPrefix}-title`} className="block text-sm">
          Type the exact topic title
          <Input
            id={`${fieldPrefix}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <Reason value={reason} setValue={setReason} />
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button
          variant="destructive"
          disabled={
            mutation.isPending || title !== thread.title || reason.trim().length < 3
          }
        >
          Permanently purge topic
        </Button>
      </form>
    </details>
  );
}

/** Distinguish author-only edit/remove policy from delegated moderation capabilities in staff labels. */
function capabilityLabel(capability: string, effective = false) {
  const labels: Record<string, string> = {
    view: "See boards",
    read: "Read topics",
    create: "Create topics",
    reply: "Reply",
    upload: "Embed media",
    vote: "React & vote",
    edit: effective ? "Edit own posts" : "Edit any post",
    remove: effective ? "Remove own posts" : "Remove any post",
    editOthers: "Edit others' posts",
    removeOthers: "Remove others' posts",
    moderate: "Moderate discussions",
    approve: "Approve posts",
    manage: "Manage forum",
    purge: "Permanently purge removed content",
  };
  return labels[capability] ?? capability;
}

type Administration = NonNullable<RouterOutputs["forum"]["administration"]>;
