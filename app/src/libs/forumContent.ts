import sanitize, { htmlToModerationText, stripBlockquotes } from "@/utils/sanitize";

/** Quotes preserve attribution without repeatedly pinging people quoted by other players. */
export const forumMentionNames = (content: string) => {
  const authored = stripBlockquotes(content);
  return [
    ...new Set(
      Array.from(
        htmlToModerationText(authored).matchAll(/@([\p{L}\p{N}_-]+)/gu),
        (match) => match[1],
      ).filter((name): name is string => !!name),
    ),
  ];
};

/** Call after sanitization: markup alone must never create an empty discussion. */
export const hasForumContent = (content: string) => {
  let hasMedia = false;
  sanitize(content, {
    onOpenTag: (tag, attributes) => {
      if (["img", "iframe"].includes(tag) && attributes.src) hasMedia = true;
    },
  });
  return hasMedia || htmlToModerationText(content).trim().length >= 4;
};
