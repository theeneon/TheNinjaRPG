"use client";

import { useId, useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showMutationToast } from "@/libs/toast";

/** Apply one audited action to selected topics; approval-only staff receive only the approval action. */
export const ForumTopicTools = ({
  ids,
  onDone,
  thread,
  onlyApprove = false,
}: {
  ids: string[];
  onDone: () => void;
  onlyApprove?: boolean;
  thread?: NonNullable<RouterOutputs["comments"]["getForumComments"]["thread"]>;
}) => {
  const fieldPrefix = useId();
  const [action, setAction] = useState<
    "PIN" | "UNPIN" | "LOCK" | "UNLOCK" | "REMOVE" | "RESTORE" | "APPROVE" | "UPDATE"
  >("LOCK");
  const [reason, setReason] = useState("");
  const [title, setTitle] = useState(thread?.title ?? "");
  const [boardId, setBoardId] = useState("");
  const [kind, setKind] = useState<"" | "DISCUSSION" | "QUESTION" | "ANNOUNCEMENT">(
    thread?.kind ?? "",
  );
  const effectiveAction = onlyApprove ? "APPROVE" : action;
  const [replaceTags, setReplaceTags] = useState(false);
  const [tags, setTags] = useState(thread?.tags.join(", ") ?? "");
  const [error, setError] = useState("");
  const context = api.forum.getContext.useQuery();
  const utils = api.useUtils();
  const mutation = api.forum.moderateThreads.useMutation();
  return (
    <form
      className="bg-muted/30 space-y-3 rounded-lg border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          const result = await mutation.mutateAsync({
            ids,
            action: effectiveAction,
            reason,
            ...(effectiveAction === "UPDATE"
              ? {
                  title: title || undefined,
                  boardId: boardId || undefined,
                  kind: kind || undefined,
                  tags: replaceTags
                    ? tags
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean)
                    : undefined,
                }
              : {}),
          });
          showMutationToast(result);
          if (!result.success) {
            setError(result.message);
            return;
          }
          await Promise.all([
            utils.forum.invalidate(),
            utils.comments.getForumComments.invalidate(),
          ]);
          onDone();
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "The moderation change could not be saved.",
          );
        }
      }}
    >
      <h3 className="font-semibold">
        Topic tools <span className="text-sm font-normal">({ids.length} selected)</span>
      </h3>
      <label className="block text-sm">
        Action
        <select
          className="bg-background mt-1 block h-10 w-full rounded-md border px-2"
          value={effectiveAction}
          onChange={(e) => setAction(e.target.value as typeof action)}
        >
          {(onlyApprove
            ? [["APPROVE", "Approve topic"]]
            : [
                ["LOCK", "Lock replies"],
                ["UNLOCK", "Unlock replies"],
                ["PIN", "Pin topic"],
                ["UNPIN", "Unpin topic"],
                ["UPDATE", "Edit title, tags, type or move"],
                ["REMOVE", "Remove (recoverable)"],
                ["RESTORE", "Restore topic"],
                ["APPROVE", "Approve topic"],
              ]
          ).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {effectiveAction === "UPDATE" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {ids.length === 1 && (
            <label className="text-sm" htmlFor={`${fieldPrefix}-1`}>
              Topic title
              <Input
                id={`${fieldPrefix}-1`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={88}
              />
            </label>
          )}
          <label className="text-sm">
            Move to board
            <select
              className="bg-background block h-10 w-full rounded-md border px-2"
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
            >
              <option value="">Keep current board</option>
              {context.data?.boards
                .filter((b) => b.permissions.moderate && !b.permissions.archived)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            Discussion type
            <select
              className="bg-background block h-10 w-full rounded-md border px-2"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="">Keep existing type</option>
              <option value="DISCUSSION">Discussion</option>
              <option value="QUESTION">Question</option>
              <option value="ANNOUNCEMENT">Announcement</option>
            </select>
          </label>
          <label className="text-sm" htmlFor={`${fieldPrefix}-2`}>
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={replaceTags}
                onChange={(e) => setReplaceTags(e.target.checked)}
              />
              Replace tags
            </span>
            <Input
              id={`${fieldPrefix}-2`}
              value={tags}
              disabled={!replaceTags}
              onChange={(e) => setTags(e.target.value)}
            />
          </label>
        </div>
      )}
      {effectiveAction === "UPDATE" && boardId && (
        <p className="text-sm text-muted-foreground">
          Moving a topic applies the destination board’s access policy. Its type, tags
          and accepted answer stay unchanged unless you edit them here.
        </p>
      )}
      <label className="block text-sm" htmlFor={`${fieldPrefix}-3`}>
        Reason
        <Input
          id={`${fieldPrefix}-3`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={3}
          maxLength={500}
          placeholder="Explain this change for the moderation log"
        />
      </label>
      {effectiveAction === "REMOVE" && (
        <p className="text-sm">
          Selected topics will leave the forum. Staff can restore them from the
          workspace.
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" disabled={mutation.isPending || reason.trim().length < 3}>
        {mutation.isPending ? "Saving…" : "Apply changes"}
      </Button>
    </form>
  );
};

/** Copy, merge or split a topic while preserving selected post identities for server-side validation. */
export const ForumRestructureTools = ({
  thread,
  postIds,
  onDone,
}: {
  thread: NonNullable<RouterOutputs["comments"]["getForumComments"]["thread"]>;
  postIds: string[];
  onDone: (boardId: string, threadId: string) => void;
}) => {
  const fieldPrefix = useId();
  const context = api.forum.getContext.useQuery();
  const [action, setAction] = useState<"COPY" | "MERGE" | "SPLIT">("COPY");
  const [boardId, setBoardId] = useState(thread.boardId);
  const [title, setTitle] = useState(thread.title);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const mutation = api.forum.restructureTopic.useMutation();
  const utils = api.useUtils();
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer text-sm font-semibold">
        Copy, merge or split this topic
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          let targetThreadId: string | undefined;
          if (action === "MERGE") {
            try {
              const path = new URL(target, window.location.origin).pathname
                .split("/")
                .filter(Boolean);
              if (path[0] !== "forum" || path.length !== 3) throw new Error("invalid");
              targetThreadId = path[2];
            } catch {
              setError("Paste the link to the destination forum topic.");
              return;
            }
          }
          try {
            const result = await mutation.mutateAsync({
              threadId: thread.id,
              action,
              boardId,
              targetThreadId,
              title: action === "MERGE" ? undefined : title,
              postIds,
              reason,
            });
            showMutationToast(result);
            if (result.success && result.boardId && result.threadId) {
              await Promise.all([
                utils.forum.invalidate(),
                utils.comments.getForumComments.invalidate(),
              ]);
              onDone(result.boardId, result.threadId);
            } else setError(result.message);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Topic restructuring failed.");
          }
        }}
      >
        <label className="block text-sm">
          Action
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as typeof action)}
            className="bg-background block h-10 w-full rounded-md border px-2"
          >
            <option value="COPY">Copy visible posts to a new topic</option>
            <option value="MERGE">Merge all posts into another topic</option>
            <option value="SPLIT">Move selected posts into a new topic</option>
          </select>
        </label>
        {action === "MERGE" ? (
          <label htmlFor={`${fieldPrefix}-target`} className="block text-sm">
            Destination topic link
            <Input
              id={`${fieldPrefix}-target`}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="Paste the topic URL"
              required
            />
          </label>
        ) : (
          <>
            <label htmlFor={`${fieldPrefix}-title`} className="block text-sm">
              New topic title
              <Input
                id={`${fieldPrefix}-title`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                minLength={4}
                maxLength={88}
                required
              />
            </label>
            <label className="block text-sm">
              Destination board
              <select
                value={boardId}
                onChange={(e) => setBoardId(e.target.value)}
                className="bg-background block h-10 w-full rounded-md border px-2"
              >
                {context.data?.boards
                  .filter((b) => b.permissions.moderate && !b.permissions.archived)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        <p className="text-muted-foreground text-sm">
          {action === "SPLIT"
            ? `${postIds.length} posts selected. Use the checkboxes beside post numbers; leave at least one post in the original topic.`
            : action === "MERGE"
              ? "All posts will move to the destination. The original topic will leave public listings. Check the destination board's audience before continuing."
              : "Copies retain author attribution. Removed and unapproved posts stay out of the copy."}
        </p>
        <label htmlFor={`${fieldPrefix}-reason`} className="block text-sm">
          Reason
          <Input
            id={`${fieldPrefix}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={3}
            maxLength={500}
            required
          />
        </label>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button
          disabled={
            mutation.isPending ||
            reason.trim().length < 3 ||
            (action === "SPLIT" && !postIds.length)
          }
        >
          {mutation.isPending ? "Saving…" : "Apply restructuring"}
        </Button>
      </form>
    </details>
  );
};
