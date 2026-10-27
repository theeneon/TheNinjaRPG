import { cookies } from "next/headers";
import { handleEndpointError, lockWithWeeklyTimer } from "@/libs/gamesettings";
import { updateAnbuSquadForGET } from "@/queries/anbu";
import { updateUserDataForWeeklyPvpReset as updateUserDataForGET } from "@/queries/pvprank";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { periodStart } from "@/utils/time";

const ENDPOINT_NAME = "weekly-pvp";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const timerCheck = await lockWithWeeklyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewWeek && timerCheck.response) return timerCheck.response;

  // Perform work
  try {
    const weekStart = periodStart("weekly", new Date());
    await Promise.all([
      // Kills earned after the week boundary survive a delayed reset or job retry.
      // Leave updatedAt alone: it doubles as last activity (online counts, cleanup,
      // sector lists), and no snapshot claim writes these columns as absolute values.
      updateUserDataForGET(drizzleDB, weekStart),
      updateAnbuSquadForGET(drizzleDB),
    ]);
    return Response.json(`OK`);
  } catch (cause) {
    // Rollback
    await timerCheck.release();
    return await handleEndpointError(cause);
  }
}
