import { memo, useMemo } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { CommentOnConversation } from "@/layout/Comment";
import { parseHtml } from "@/utils/parse";

export const ConversationComments = ({
  canInteract,
  pages,
  conversationId,
  deletedCommentIds,
  quoteIds,
  username,
  tavernStyling,
  setLastElement,
  onReact,
  onToggleQuote,
  onDeleted,
}: ConversationCommentsProps) => {
  const unique = new Set<string>();
  const visibleComments = pages
    ?.flatMap((page) => page.data)
    .filter((comment) => comment.conversationId === conversationId)
    .filter((comment) => !deletedCommentIds.has(comment.id))
    .filter((comment) => {
      const duplicate = unique.has(comment.id);
      unique.add(comment.id);
      return !duplicate;
    });

  return (
    <>
      {visibleComments?.map((comment, i) => (
        <div
          key={comment.id}
          ref={i === visibleComments.length - 1 ? setLastElement : null}
        >
          <ConversationCommentRow
            comment={comment}
            isQuoted={quoteIds?.includes(comment.id) ?? false}
            isHighlighted={
              comment.content.includes(`quote author="${username}`) ||
              comment.content.includes(`@${username}`)
            }
            tavernStyling={tavernStyling}
            canInteract={canInteract}
            onReact={onReact}
            onToggleQuote={onToggleQuote}
            onDeleted={onDeleted}
          />
        </div>
      ))}
    </>
  );
};

// Cache updates preserve unchanged comment objects. Keep row-local callbacks and
// parsed content behind this boundary so a chat event only renders changed rows.
const ConversationCommentRow = memo(function ConversationCommentRow({
  comment,
  isQuoted,
  isHighlighted,
  tavernStyling,
  canInteract,
  onReact,
  onToggleQuote,
  onDeleted,
}: ConversationCommentRowProps) {
  const content = useMemo(() => parseHtml(comment.content), [comment.content]);

  return (
    <CommentOnConversation
      user={comment}
      hover_effect={false}
      comment={comment}
      quoteIds={isQuoted ? [comment.id] : null}
      tavernStyling={tavernStyling}
      color={isHighlighted ? "poppopover" : undefined}
      toggleReaction={
        canInteract ? (emoji) => onReact({ commentId: comment.id, emoji }) : undefined
      }
      canEdit={canInteract}
      setQuoteId={canInteract ? onToggleQuote : undefined}
      onDeleted={onDeleted}
    >
      {content}
    </CommentOnConversation>
  );
});

interface ConversationCommentsProps {
  pages?: RouterOutputs["comments"]["getConversationComments"][];
  conversationId?: string;
  deletedCommentIds: Set<string>;
  quoteIds: string[] | null;
  username?: string;
  tavernStyling?: boolean;
  setLastElement: (element: HTMLDivElement | null) => void;
  onReact: (reaction: { commentId: string; emoji: string }) => void;
  onToggleQuote: (quoteId: string) => void;
  onDeleted: (commentId: string) => void;
  canInteract: boolean;
}

type ConversationCommentRowProps = Pick<
  ConversationCommentsProps,
  "tavernStyling" | "canInteract" | "onReact" | "onToggleQuote" | "onDeleted"
> & {
  comment: RouterOutputs["comments"]["getConversationComments"]["data"][number];
  isQuoted: boolean;
  isHighlighted: boolean;
};
