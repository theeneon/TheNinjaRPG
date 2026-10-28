import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";
import { selectDistinctUserDeviceForNotifyWarVillages } from "@/queries/push";
import type { DrizzleClient } from "@/server/db";
import { isPushEnabled, sendPushToUsers } from "@/server/utils/push";
import { warUpdate } from "./messages";

/** Only committed war transitions call this; roster queries stay off their response. */
export const notifyWarVillages = (
  client: DrizzleClient,
  villageIds: string[],
  warId: string,
) => {
  const villages = [...new Set(villageIds)].filter(Boolean);
  if (!villages.length || !isPushEnabled()) return;
  after(async () => {
    try {
      const recipients = await selectDistinctUserDeviceForNotifyWarVillages(
        client,
        villages,
      );
      await sendPushToUsers(
        client,
        recipients.map(({ userId }) => userId),
        warUpdate(warId),
      );
    } catch (error) {
      Sentry.captureException(error, { tags: { source: "warPush" } });
    }
  });
};
