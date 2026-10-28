import * as Sentry from "@sentry/nextjs";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { after } from "next/server";
import { FORUM_MIN_LEVEL, forumLevelMessage } from "@/drizzle/constants";
import { forumPost } from "@/drizzle/schema";
import { resolveSenderId } from "@/libs/comments";
import { forumWriteSnapshotMatches, getForumContext } from "@/libs/forum";
import { forumBoardPermissions } from "@/libs/forumAccess";
import { forumMentionNames, hasForumContent } from "@/libs/forumContent";
import { deferModeration } from "@/libs/moderation/defer";
import {
  fetchThread,
  findForumPost,
  insertForumAlerts,
  insertForumAudit,
  insertForumPost,
  insertForumRevision,
  lastForumPostByAuthor,
  listForumBoards,
  listForumNotificationActors,
  listForumNotificationBlocks,
  listForumNotificationGrants,
  listForumWatchers,
  lockForumBoard,
  lockForumSection,
  lockForumThread,
  repairForumBoard,
  repairForumThread,
  updateForumPost,
} from "@/queries/forum";
import { fetchUser } from "@/queries/profile";
import { errorResponse } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { sendPushToUsers } from "@/server/utils/push";
import { processMentions } from "@/utils/chat";
import { moderateUserText } from "@/utils/profanity";
import type { MutateCommentSchema } from "@/validators/comments";

export const createForumReply = async (
  db: DrizzleClient,
  userId: string,
  input: MutateCommentSchema,
) => {
  const [context, thread, user, sender, moderated] = await Promise.all([
    getForumContext(db, userId),
    fetchThread(db, input.object_id),
    fetchUser(db, userId),
    input.senderId ? fetchUser(db, input.senderId) : null,
    moderateUserText(input.comment),
  ]);
  const board = context.boards.find((b) => b.id === thread?.boardId);
  if (!thread || thread.deletedAt || !thread.isApproved || !board?.permissions.read)
    return errorResponse("Topic not found");
  if (!board.permissions.reply)
    return errorResponse(
      board.restriction
        ? `Forum posting restricted: ${board.restriction.reason}`
        : "You cannot reply in this board",
    );
  if (user.level < FORUM_MIN_LEVEL) return errorResponse(forumLevelMessage);
  if (thread.isLocked) return errorResponse("This topic is locked");
  if (!moderated.success) return moderated;
  if (!hasForumContent(moderated.sanitized))
    return errorResponse("Write a message or add an image before posting");
  if (
    !board.permissions.upload &&
    /<(?:img|iframe|video|audio)\b/i.test(moderated.sanitized)
  )
    return errorResponse("Attachments are disabled in this board");
  const effectiveUserId = resolveSenderId(user, sender);
  const { processedContent: content } = processMentions(moderated.sanitized);
  const id = nanoid();
  // A post INSERT and its topic/board counters cannot be committed by one SQL statement.
  // Serialize on existing parents so a concurrent lock or archive cannot admit a reply.
  const result = await retryOnDeadlock(() =>
    db.transaction(async (tx) => {
      await lockForumSection(tx, board.sectionId);
      const [currentBoard] = await lockForumBoard(tx, board.id);
      const [currentThread] = await lockForumThread(tx, thread.id);
      if (
        !(await forumWriteSnapshotMatches(tx, context, board.id)) ||
        currentBoard?.archived ||
        currentBoard?.sectionArchived ||
        !currentThread ||
        currentThread.deletedAt ||
        currentThread.isLocked ||
        currentThread.boardId !== board.id
      )
        return errorResponse("This topic changed or is locked. Refresh and try again.");
      if (board.slowModeSeconds && !board.permissions.moderate) {
        const last = await lastForumPostByAuthor(tx, thread.id, userId);
        if (
          last &&
          Date.now() - last.createdAt.getTime() < board.slowModeSeconds * 1000
        )
          return errorResponse(
            `Slow mode is enabled. Wait ${board.slowModeSeconds} seconds between replies.`,
          );
      }
      const isApproved = !board.requireApproval || board.permissions.approve;
      await insertForumPost(tx, {
        id,
        content,
        threadId: thread.id,
        userId: effectiveUserId,
        authorId: userId,
        isApproved,
      });
      await repairForumThread(tx, thread.id);
      await repairForumBoard(tx, board.id);
      return {
        success: true,
        message: isApproved ? "Reply posted" : "Reply submitted for staff approval",
        approved: isApproved,
      };
    }),
  );
  if (result.success) {
    deferModeration(db, {
      content,
      userId,
      relationType: "forumPost",
      relationId: id,
      contextId: thread.id,
    });
    if ("approved" in result && result.approved)
      deferForumAlerts(db, {
        boardId: board.id,
        threadId: thread.id,
        postId: id,
        actorId: userId,
        mentionedUserNames: forumMentionNames(content),
      });
  }
  return result;
};

export const editForumPost = async (
  db: DrizzleClient,
  userId: string,
  input: MutateCommentSchema & { reason?: string },
) => {
  const [context, post, moderated] = await Promise.all([
    getForumContext(db, userId),
    findForumPost(db, input.object_id),
    moderateUserText(input.comment),
  ]);
  const thread = post ? await fetchThread(db, post.threadId) : null;
  const board = context.boards.find((b) => b.id === thread?.boardId);
  const own = post?.authorId === userId;
  if (
    !post ||
    post.deletedAt ||
    !thread ||
    thread.deletedAt ||
    !board?.permissions.read
  )
    return errorResponse("Post not found");
  if (
    !context.actor ||
    context.actor.isBanned ||
    context.actor.isSilenced ||
    (!own && !board.permissions.editOthers) ||
    (own && !board.permissions.edit && !board.permissions.editOthers)
  )
    return errorResponse("You cannot edit this post");
  if ((post.isLocked || thread.isLocked) && !board.permissions.moderate)
    return errorResponse("This post is locked");
  if (!own && !input.reason?.trim())
    return errorResponse("A reason is required when editing another player's post");
  if (!moderated.success) return moderated;
  if (!hasForumContent(moderated.sanitized))
    return errorResponse("Write a message or add an image before posting");
  if (
    !board.permissions.upload &&
    /<(?:img|iframe|video|audio)\b/i.test(moderated.sanitized)
  )
    return errorResponse("Attachments are disabled in this board");
  const content = processMentions(moderated.sanitized).processedContent;
  const reason = input.reason?.trim() || "Author edit";
  // Revision history must be committed with the corresponding edit; SQL cannot insert and update together.
  const result = await retryOnDeadlock(() =>
    db.transaction(async (tx) => {
      await lockForumSection(tx, board.sectionId);
      const [currentBoard] = await lockForumBoard(tx, board.id);
      const [currentThread] = await lockForumThread(tx, thread.id);
      if (
        !(await forumWriteSnapshotMatches(tx, context, board.id)) ||
        currentBoard?.archived ||
        currentBoard?.sectionArchived ||
        !currentThread ||
        currentThread.boardId !== board.id ||
        currentThread.deletedAt ||
        (currentThread.isLocked && !board.permissions.moderate)
      )
        return errorResponse("This topic changed. Refresh and try again.");
      const updated = await updateForumPost(
        tx,
        post.id,
        { content, editedAt: new Date() },
        and(
          eq(forumPost.content, post.content),
          eq(forumPost.threadId, thread.id),
          isNull(forumPost.deletedAt),
          board.permissions.moderate ? undefined : eq(forumPost.isLocked, false),
        ),
      );
      if (!updated.rowsAffected)
        return errorResponse("This post changed. Refresh before editing it again.");
      await insertForumRevision(tx, {
        postId: post.id,
        actorId: userId,
        content: post.content,
        reason,
      });
      await insertForumAudit(tx, {
        actorId: userId,
        boardId: board.id,
        action: "post.edit",
        targetId: post.id,
        reason,
        before: { content: post.content },
        after: { content },
      });
      return { success: true, message: "Post updated" };
    }),
  );
  if (result.success)
    deferModeration(db, {
      content,
      userId,
      relationType: "forumPost",
      relationId: post.id,
      contextId: thread.id,
      createdAt: post.createdAt,
    });
  return result;
};

export const removeForumPost = async (
  db: DrizzleClient,
  userId: string,
  id: string,
  reason = "Author removal",
) => {
  const [context, post] = await Promise.all([
    getForumContext(db, userId),
    findForumPost(db, id),
  ]);
  const thread = post ? await fetchThread(db, post.threadId) : null;
  const board = context.boards.find((b) => b.id === thread?.boardId);
  if (
    !post ||
    !thread ||
    !board?.permissions.read ||
    post.deletedAt ||
    thread.deletedAt
  )
    return errorResponse("Post not found");
  const own = post.authorId === userId;
  if (
    !context.actor ||
    context.actor.isBanned ||
    context.actor.isSilenced ||
    (!own && !board.permissions.removeOthers) ||
    (own && !board.permissions.remove && !board.permissions.removeOthers)
  )
    return errorResponse("You cannot remove this post");
  if (!board.permissions.moderate && (thread.isLocked || post.isLocked))
    return errorResponse("This post is locked");
  // Soft removal, accepted-answer cleanup and both counters form one recoverable unit.
  return retryOnDeadlock(() =>
    db.transaction(async (tx) => {
      await lockForumSection(tx, board.sectionId);
      await lockForumBoard(tx, board.id);
      const [currentThread] = await lockForumThread(tx, thread.id);
      if (
        !currentThread ||
        currentThread.boardId !== board.id ||
        currentThread.deletedAt ||
        (!board.permissions.moderate && currentThread.isLocked)
      )
        return errorResponse("This topic changed. Refresh and try again.");
      const result = await updateForumPost(
        tx,
        post.id,
        { deletedAt: new Date(), removedBy: userId, removalReason: reason },
        and(
          isNull(forumPost.deletedAt),
          eq(forumPost.threadId, thread.id),
          board.permissions.moderate ? undefined : eq(forumPost.isLocked, false),
        ),
      );
      if (!result.rowsAffected)
        return errorResponse(
          "This post changed, is locked or was already removed. Refresh and try again.",
        );
      await repairForumThread(tx, thread.id);
      await repairForumBoard(tx, board.id);
      await insertForumAudit(tx, {
        actorId: userId,
        boardId: board.id,
        action: own ? "post.author-remove" : "post.moderator-remove",
        targetId: post.id,
        reason,
      });
      return { success: true, message: "Post removed. Staff can restore it." };
    }),
  );
};

/** Notifications are created after commit and readers are re-authorized when opening the inbox. */
export const deferForumAlerts = (
  db: DrizzleClient,
  input: {
    boardId: string;
    threadId: string;
    postId: string;
    actorId: string;
    mentionedUserNames?: string[];
  },
) => {
  after(async () => {
    try {
      const [watchers, boards, actors, blocks] = await Promise.all([
        listForumWatchers(db, input.boardId, input.threadId),
        listForumBoards(db),
        listForumNotificationActors(
          db,
          input.boardId,
          input.threadId,
          input.mentionedUserNames ?? [],
        ),
        listForumNotificationBlocks(db, input.actorId),
      ]);
      const board = boards.find((b) => b.id === input.boardId);
      if (!board || !actors.length) return;
      const grants = await listForumNotificationGrants(
        db,
        actors.map((a) => a.userId),
      );
      const recipients = actors
        .filter(
          (actor) =>
            actor.userId !== input.actorId &&
            !actor.isBanned &&
            !blocks.some(
              (b) =>
                b.creatorUserId === actor.userId || b.targetUserId === actor.userId,
            ) &&
            forumBoardPermissions(actor, board, boards, grants).read,
        )
        .map((actor) => actor.userId);
      if (!recipients.length) return;
      await insertForumAlerts(
        db,
        recipients.map((userId) => ({
          id: nanoid(),
          userId,
          threadId: input.threadId,
          postId: input.postId,
        })),
      );
      const push = recipients.filter((id) =>
        watchers.some((w) => w.userId === id && w.push),
      );
      if (push.length)
        await sendPushToUsers(db, push, {
          category: "social",
          title: "Forum activity",
          body: "A discussion you watch has a new post.",
          url: `/forum/${input.boardId}/${input.threadId}?post=${input.postId}`,
        });
    } catch (error) {
      Sentry.captureException(error, { tags: { source: "forum-notifications" } });
    }
  });
};
