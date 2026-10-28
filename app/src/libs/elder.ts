import {
  fetchElderVote,
  insertVillageElderVoteEntryForCastElderVoteEntry,
  listVillageElderVoteForFetchElderVotes,
  selectUserDataForFetchElderVotes,
  selectVillageForFetchElderVotes,
} from "@/queries/elder";
import type { DrizzleClient } from "@/server/db";

/**
 * Fetch all pending elder votes for a village, with enriched target names
 */
export const fetchElderVotes = async (client: DrizzleClient, villageId: string) => {
  const votes = await listVillageElderVoteForFetchElderVotes(client, villageId);
  // Batch-fetch target names to avoid N+1 queries
  const villageTargetIds = [
    ...new Set(
      votes.filter((v) => v.type === "WAR_DECLARATION").map((v) => v.targetId),
    ),
  ];
  const userTargetIds = [
    ...new Set(votes.filter((v) => v.type === "KAGE_REMOVAL").map((v) => v.targetId)),
  ];
  const [targetVillages, targetUsers] = await Promise.all([
    villageTargetIds.length > 0
      ? selectVillageForFetchElderVotes(client, villageTargetIds)
      : [],
    userTargetIds.length > 0
      ? selectUserDataForFetchElderVotes(client, userTargetIds)
      : [],
  ]);
  const villageById = Object.fromEntries(targetVillages.map((v) => [v.id, v.name]));
  const userById = Object.fromEntries(targetUsers.map((u) => [u.userId, u.username]));
  return votes.map((vote) => {
    let targetName = vote.targetId;
    if (vote.type === "WAR_DECLARATION") {
      targetName = villageById[vote.targetId] ?? vote.targetId;
    } else if (vote.type === "KAGE_REMOVAL") {
      targetName = userById[vote.targetId] ?? vote.targetId;
    }
    return { ...vote, targetName };
  });
};

/**
 * Determine outcome of an elder vote based on simple majority.
 * Majority = more than half of eligible elders (Math.floor(elderCount / 2) + 1).
 * If all elders have voted and it's a tie → REJECTED.
 */
export const resolveElderVote = (
  yesCount: number,
  noCount: number,
  elderCount: number,
  isExpired = false,
  autoApprove = false,
): "APPROVED" | "REJECTED" | "PENDING" => {
  const majority = Math.floor(elderCount / 2) + 1;
  if (yesCount >= majority) return "APPROVED";
  if (noCount >= majority) return "REJECTED";
  // All elders voted and it's a tie → cancelled
  if (yesCount + noCount >= elderCount && yesCount === noCount) return "REJECTED";
  if (isExpired) {
    // autoApprove (WAR_DECLARATION): war starts unless a majority actively blocked it
    if (autoApprove) return "APPROVED";
    // !autoApprove (KAGE_REMOVAL): removal requires a true majority, not just a plurality
    return "REJECTED";
  }
  return "PENDING";
};

/**
 * Insert an elder vote entry, re-fetch the fresh entry list, and resolve the
 * current outcome. Returns null when the user has already voted (duplicate).
 */
export const castElderVoteEntry = async (
  client: DrizzleClient,
  voteId: string,
  userId: string,
  vote: "YES" | "NO",
  elderCount: number,
): Promise<{
  outcome: "APPROVED" | "REJECTED" | "PENDING";
  freshEntries: NonNullable<Awaited<ReturnType<typeof fetchElderVote>>>["entries"];
} | null> => {
  const insertResult = await insertVillageElderVoteEntryForCastElderVoteEntry(
    client,
    voteId,
    userId,
    vote,
  );
  if (!insertResult.rowsAffected) return null;

  const freshVote = await fetchElderVote(client, voteId);
  const freshEntries = freshVote?.entries ?? [];
  const yesCount = freshEntries.filter((e) => e.vote === "YES").length;
  const noCount = freshEntries.filter((e) => e.vote === "NO").length;
  const outcome = resolveElderVote(yesCount, noCount, elderCount);
  return { outcome, freshEntries };
};
