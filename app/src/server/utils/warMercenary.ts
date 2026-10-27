import { getWarSide, isObjectiveWarActive } from "@/libs/objectiveWar";
import {
  activeWarMercenaryWhere,
  executeResultForAcceptWarMercenary,
  executeRowsForAcceptWarMercenary,
  listWarForFetchWarCampEntry,
  selectWarMercenaryForFetchMercenaryWarId,
} from "@/queries/war";
import { errorResponse } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";

/** One indexed membership read; callers schedule it with their other initial queries. */
export const fetchMercenaryWarId = async (client: DrizzleClient, userId: string) => {
  const rows = await selectWarMercenaryForFetchMercenaryWarId(
    client,
    userId,
    activeWarMercenaryWhere,
  );
  return rows[0]?.warId ?? null;
};

/** Debit, pay and claim the invitation in one statement; retries cannot pay twice. */
export const acceptWarMercenary = async (
  client: DrizzleClient,
  id: string,
  userId: string,
) => {
  await executeRowsForAcceptWarMercenary(client, userId);
  try {
    const result = await retryOnDeadlock(() =>
      executeResultForAcceptWarMercenary(client, id, userId),
    );
    return result.rowsAffected > 0
      ? {
          success: true,
          message: "Contract accepted. Your Ryo payment has been delivered.",
        }
      : errorResponse(
          "The offer, war, Kage, balance or your eligibility changed. Refresh and try again while out of battle.",
        );
  } catch (error) {
    if (isMysqlDuplicateKeyError(error))
      return errorResponse("You can only serve as a mercenary in one war at a time.");
    throw error;
  }
};

/** Camp admission reads depend only on identity and destination, so they can be prefetched. */
export const fetchWarCampEntry = async (
  client: DrizzleClient,
  userId: string,
  destination: number,
) => {
  const [wars, mercenaryWarId] = await Promise.all([
    listWarForFetchWarCampEntry(client, destination, activeWarMercenaryWhere),
    fetchMercenaryWarId(client, userId),
  ]);
  return { wars, mercenaryWarId };
};

/** Open camp sectors admit both war sides; existing occupants remain free to leave. */
export const canEnterWarCamp = (
  entry: Awaited<ReturnType<typeof fetchWarCampEntry>>,
  user: { userId: string; villageId: string | null; sector: number },
  destination: number,
) => {
  if (destination === user.sector) return true;
  return entry.wars
    .filter((w) => isObjectiveWarActive(w))
    .every((w) => !!getWarSide(w, user.villageId, user.userId, entry.mercenaryWarId));
};

/** Resolve admission when the destination could not be predicted before loading its map. */
export const canEnterWarCampSector = async (
  client: DrizzleClient,
  user: { userId: string; villageId: string | null; sector: number },
  destination: number,
) => {
  if (destination === user.sector) return true;
  return canEnterWarCamp(
    await fetchWarCampEntry(client, user.userId, destination),
    user,
    destination,
  );
};
