import { findUserReportWithUsers } from "@/queries/reports";
import type { DrizzleClient } from "@/server/db";

/**
 * Load a report or return null; hide both reporter identity fields from its subject.
 * Callers remain responsible for authorizing report access.
 */
export const fetchUserReport = async (
  client: DrizzleClient,
  userReportId: string,
  fetcherUserId: string,
) => {
  const entry = await findUserReportWithUsers(client, userReportId);
  if (!entry) return null;
  // If fetching report on yourself, hide reporter
  if (fetcherUserId === entry.reportedUserId) {
    entry.reporterUser = null;
    entry.reporterUserId = null;
  }
  return entry;
};
