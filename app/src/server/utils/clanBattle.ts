import {
  deleteBattleActionForClearClanCombat,
  deleteBattleForClearClanCombat,
  deleteMpvpBattleQueueForDeleteClanBattle,
  deleteMpvpBattleUserForDeleteClanBattle,
  executeCreditedForRewardClanBattleVictory,
  updateUserDataForClearClanCombat,
  updateUserDataForDeleteClanBattle,
} from "@/queries/clan";
import { deleteBattleHistoryByBattleId } from "@/queries/combat";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

/**
 * Claim and credit a shared victory atomically, so participant reports and retries pay once.
 * Returns true only when an unclaimed clan battle credits its participating winning clan;
 * missing lobbies/clans, other battle types and duplicate reports return false. A failed
 * credit leaves the winner unclaimed and balances unchanged; deadlocks retry the statement.
 */
export const rewardClanBattleVictory = async (
  client: DrizzleClient,
  battleId: string,
  clanId: string,
) =>
  retryOnDeadlock(async () => {
    // Drizzle's MySQL update builder cannot JOIN and SET both tables. As with purchase
    // delivery, parameterized SQL keeps the claim and credit in one atomic statement.
    const credited = await executeCreditedForRewardClanBattleVictory(
      client,
      clanId,
      battleId,
    );
    return credited.rowsAffected > 0;
  });

type ClanBattleSnapshot = { id: string; battleId: string | null };

/**
 * Claim deletion of exactly the observed clan lobby, then release its combat and members.
 * Returns false without cleanup when the lobby is gone or its combat reservation changed;
 * true means cleanup completed. The guarded DELETE serializes startup and payout, and does
 * not reverse credited rewards. Cleanup retries only idempotent writes for the old IDs.
 * A persistent database failure after the DELETE can leave combat, logs, memberships or
 * queued users for support cleanup: the lobby stays deleted and the router cannot retry it.
 */
export const deleteClanBattle = async (
  client: DrizzleClient,
  snapshot: ClanBattleSnapshot,
) => {
  const deleted = await retryOnDeadlock(() =>
    deleteMpvpBattleQueueForDeleteClanBattle(client, snapshot),
  );
  if (deleted.rowsAffected !== 1) return false;
  // The deletion is durable. Retry cleanup alone so a deadlock cannot skip it when
  // a second DELETE finds no lobby; retain memberships until queued users are awake.
  await retryOnDeadlock(async () => {
    if (snapshot.battleId !== null) await clearClanCombat(client, snapshot.battleId);
    // Completed lobbies retain memberships after participants can join ranked PvP.
    // Only a claimed ranked row owns QUEUED. A provisional ranked join may have
    // lost its claim to this clan lobby and must not block the lobby's wake-up.
    await updateUserDataForDeleteClanBattle(client, snapshot);
    await deleteMpvpBattleUserForDeleteClanBattle(client, snapshot);
  });
  return true;
};

/**
 * Idempotently remove combat and logs for an exclusive clan combat ID, including a startup
 * that lost its lobby. Release only users still holding that ID, preserving newer combats
 * and non-battle statuses. Writes finish in order before resolving; a database failure may
 * leave partial cleanup, which can safely be retried with the same ID.
 */
export const clearClanCombat = async (client: DrizzleClient, battleId: string) => {
  await deleteBattleForClearClanCombat(client, battleId);
  await updateUserDataForClearClanCombat(client, battleId);
  await deleteBattleActionForClearClanCombat(client, battleId);
  await deleteBattleHistoryByBattleId(client, battleId);
};
