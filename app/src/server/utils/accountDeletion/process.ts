import * as Sentry from "@sentry/nextjs";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { accountDeletion } from "@/drizzle/schema";
import {
  listAccountDeletionForProcessDueDeletions,
  updateAccountDeletionForAdvance,
  updateAccountDeletionForProcessDueDeletions,
  updateAccountDeletionForProcessDueDeletions2,
} from "@/queries/accountDeletion";
import { drizzleDB } from "@/server/db";
import { removeAccountGameData } from "@/server/utils/accountDeletion/cleanup";
import { removeAccountIdentity } from "@/server/utils/accountDeletion/identity";
import { runDeletionStep } from "@/server/utils/accountDeletion/worker";

/** Shared by the post-response kick-off and the cleaner. Leases arbitrate both callers. */
export const processAccountDeletions = async (userId?: string) => {
  try {
    return await processDueDeletions(userId);
  } catch (error) {
    // A database outage must not undo acceptance of an already durable request.
    // The next cleaner invocation can retry once the database is available.
    Sentry.captureException(error, { tags: { task: "account-deletion" } });
    return { processed: 0, failed: 1 };
  }
};

const processDueDeletions = async (userId?: string) => {
  const now = new Date();
  const jobs = await listAccountDeletionForProcessDueDeletions(drizzleDB, userId, now);
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    const leaseId = nanoid();
    const claim = await updateAccountDeletionForProcessDueDeletions(
      drizzleDB,
      leaseId,
      job,
      now,
    );
    if (claim.rowsAffected !== 1) continue;
    const ownedLease = and(
      eq(accountDeletion.userId, job.userId),
      eq(accountDeletion.leaseId, leaseId),
    );
    try {
      await runDeletionStep({
        phase: job.phase,
        removeIdentity: () =>
          removeAccountIdentity(job.userId, job.appleRevokedSubject),
        removeGameData: () => removeAccountGameData(job.userId),
        advance: async (phase, delayMs) => {
          const changed = await updateAccountDeletionForAdvance(
            drizzleDB,
            phase,
            delayMs,
            job,
            ownedLease,
          );
          if (changed.rowsAffected !== 1)
            throw new Error("Account deletion lease lost");
        },
      });
      processed++;
    } catch (error) {
      failed++;
      Sentry.captureException(error, {
        tags: { task: "account-deletion" },
        extra: { userId: job.userId, phase: job.phase },
      });
      await updateAccountDeletionForProcessDueDeletions2(drizzleDB, ownedLease);
    }
  }
  return { processed, failed };
};
