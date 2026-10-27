import { handleEndpointError, lockWithGameTimer } from "@/libs/gamesettings";
import { buildModerationEvidence } from "@/libs/moderation/evidence";
import { indexReportEmbeddings } from "@/libs/moderation/reportSearch";
import { generateAiSummary } from "@/libs/moderator";
import {
  listUserReportForSummaryIndexer as listUserReportForGET,
  updateUserReportForGET,
} from "@/queries/reports";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

const TIMER_NAME = "indexer-1m";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const response = await lockWithGameTimer(drizzleDB, TIMER_NAME, 60_000);
  if (response) return response;

  try {
    // Fetch reports without a summary
    const reports = await listUserReportForGET(drizzleDB);

    // Generate summaries before indexing eligible resolved reports
    for (const report of reports) {
      const aiInterpretation = await generateAiSummary(
        buildModerationEvidence({
          infraction: report.infraction,
          context: report.additionalContext,
          system: report.system,
          reportedUserId: report.reportedUserId ?? undefined,
        }),
      );
      await updateUserReportForGET(drizzleDB, aiInterpretation, report);
    }

    await indexReportEmbeddings(drizzleDB);

    return Response.json(`OK`);
  } catch (cause) {
    return handleEndpointError(cause, { endpoint: "/api/indexer" });
  }
}
