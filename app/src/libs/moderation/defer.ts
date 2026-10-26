import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";
import { moderateContent } from "@/libs/moderator";
import type { DrizzleClient } from "@/server/db";

/** Schedule only after the content write succeeds; scans must not delay posting. */
export const deferModeration = (
  client: DrizzleClient,
  info: Parameters<typeof moderateContent>[1],
) => {
  // Anchor conversation context to posting time, even if the callback starts later.
  const snapshot = { ...info, createdAt: info.createdAt ?? new Date() };
  after(async () => {
    try {
      await moderateContent(client, snapshot);
    } catch (error) {
      Sentry.captureException(error, {
        tags: { source: "deferredModeration", relationType: snapshot.relationType },
        extra: { relationId: snapshot.relationId },
      });
    }
  });
};
