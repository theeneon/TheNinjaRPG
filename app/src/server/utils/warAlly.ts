import { WAR_LOSING_COOLDOWN_DAYS } from "@/drizzle/constants";

import {
  deleteWarAllyForAcceptWarAllyOffer,
  executeClosedForCloseWarAllyOffer,
  executeDeliveredForAcceptWarAllyOffer,
  executeRowsForAcceptWarAllyOffer,
  executeWithdrawnForWithdrawWarAlly,
  findWarAllyForAcceptWarAllyOffer,
} from "@/queries/war";
import { errorResponse } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { DAY_S, secondsFromDate } from "@/utils/time";

/** Closing the request must release its unpaid slot in the same status claim. */
export const closeWarAllyOffer = async (
  client: DrizzleClient,
  offerId: string,
  userId: string,
  status: "CANCELLED" | "REJECTED",
) => {
  // Drizzle cannot express a multi-table write. Ending only an unpaid reservation
  // preserves accepted history and frees the unique slot even if the response fails.
  const closed = await retryOnDeadlock(() =>
    executeClosedForCloseWarAllyOffer(client, status, offerId, userId),
  );
  return closed.rowsAffected > 0;
};

/** A pending membership is a durable receipt; admission and its payment commit in one UPDATE. */
export const acceptWarAllyOffer = async (
  client: DrizzleClient,
  offer: {
    offerId: string;
    warId: string;
    villageId: string;
    supportVillageId: string;
    userId: string;
  },
) => {
  await retryOnDeadlock(() => executeRowsForAcceptWarAllyOffer(client, offer));

  // Drizzle cannot express a multi-table write. The receipt, both balances, and
  // accepted membership change together, so a failed delivery remains retryable.
  const delivered = await retryOnDeadlock(() =>
    executeDeliveredForAcceptWarAllyOffer(client, offer),
  );
  if (delivered.rowsAffected > 0)
    return { success: true, message: "Offer accepted and alliance formed" };

  const saved = await findWarAllyForAcceptWarAllyOffer(client, offer);
  if (saved?.acceptedAt && !saved.endedAt)
    return { success: true, message: "Offer already accepted" };
  await retryOnDeadlock(() => deleteWarAllyForAcceptWarAllyOffer(client, offer));
  return errorResponse(
    "Offer changed, the war ended, or the sending village no longer has enough tokens. Refresh and try again.",
  );
};

/** Freeze withdrawal against the same War row that settlement claims. */
export const withdrawWarAlly = async (
  client: DrizzleClient,
  warId: string,
  villageId: string,
  userId: string,
) => {
  const endedAt = new Date();
  const cooldown = secondsFromDate(WAR_LOSING_COOLDOWN_DAYS * DAY_S, endedAt);
  const withdrawn = await retryOnDeadlock(() =>
    executeWithdrawnForWithdrawWarAlly(
      client,
      endedAt,
      cooldown,
      warId,
      villageId,
      userId,
    ),
  );
  if (withdrawn.rowsAffected === 0)
    return errorResponse("War or membership changed. Refresh before surrendering.");
  return { success: true, message: "War surrendered and therefore lost" };
};
