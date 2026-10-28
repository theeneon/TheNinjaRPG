import { CONTENT_PROPOSAL_RETENTION_DAYS } from "@/drizzle/constants";
import {
  deleteContentProposalBasisForCleanupContentProposals,
  deleteContentProposalChangeForCleanupContentProposals,
  deleteContentProposalForCleanupContentProposals,
  deleteContentProposalMediaForCleanupContentProposals,
  selectContentProposalForCleanupContentProposals,
  selectContentProposalMediaForCleanupContentProposals,
} from "@/queries/contentReview";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { DAY_S, secondsFromNow } from "@/utils/time";
import { deleteStoredFiles } from "./media";
import { expireStaleEvidence } from "./outdate";

/**
 * Hourly housekeeping from the cleaner cron: expire suggestions whose usage data is too old,
 * remove rejected and outdated suggestions once the retention window has passed, and delete
 * uploaded candidates nobody picked. Applied and reverted suggestions stay as history.
 * Returns how many suggestions were removed and how many candidate files were deleted.
 */
export const cleanupContentProposals = async (client: DrizzleClient) => {
  await expireStaleEvidence(client);
  const cutoff = secondsFromNow(-CONTENT_PROPOSAL_RETENTION_DAYS * DAY_S);
  const expired = await selectContentProposalForCleanupContentProposals(
    client,
    cutoff,
    BATCH,
  );
  // The parent CAS decides whether retention or refinement wins. Orphan child rows are
  // durable cleanup work, so storage failures never require holding a database lock.
  const removed = expired.length
    ? (
        await retryOnDeadlock(() =>
          deleteContentProposalForCleanupContentProposals(client, expired, cutoff),
        )
      ).rowsAffected
    : 0;
  // Read after claiming parents so this run also processes their newly orphaned media.
  // New submissions/refinements commit parents and children together, so an absent parent
  // cannot denote a draft still being saved. Applied/reverted drafts cannot be refined.
  const leftovers = await selectContentProposalMediaForCleanupContentProposals(
    client,
    LEFTOVER_GRACE_S,
    BATCH,
  );
  const keys = leftovers.flatMap((row) => (row.fileKey ? [row.fileKey] : []));
  // Files first keeps orphan rows retryable, including a crash after the parent CAS.
  await deleteStoredFiles(keys);
  await Promise.all([
    ...(leftovers.length
      ? [
          retryOnDeadlock(() =>
            deleteContentProposalMediaForCleanupContentProposals(client, leftovers),
          ),
        ]
      : []),
    retryOnDeadlock(() =>
      deleteContentProposalBasisForCleanupContentProposals(client, BATCH),
    ),
    retryOnDeadlock(() =>
      deleteContentProposalChangeForCleanupContentProposals(client, BATCH),
    ),
  ]);
  return { removed, filesDeleted: keys.length };
};

/** Suggestions and leftover files handled per run; a bigger backlog clears over later runs. */
const BATCH = 500;

/** Approval routes can run for five minutes while saving content and media selections. */
const LEFTOVER_GRACE_S = 5 * 60;
