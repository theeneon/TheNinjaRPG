import { handleEndpointError, lockWithDailyTimer } from "@/libs/gamesettings";
import { deleteOrphanedReportEmbeddings } from "@/libs/moderation/reportSearch";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

const ENDPOINT_NAME = "daily-report-embeddings";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay) return timerCheck.response;

  try {
    await deleteOrphanedReportEmbeddings(drizzleDB);
    return Response.json("OK");
  } catch (cause) {
    await timerCheck.release();
    return handleEndpointError(cause, { endpoint: "/api/daily-report-embeddings" });
  }
}
