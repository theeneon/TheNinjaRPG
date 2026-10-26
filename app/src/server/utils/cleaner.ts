import { and, eq, gt, inArray, notExists, or, type SQL, sql } from "drizzle-orm";
import type { AnyMySqlColumn, MySqlTable } from "drizzle-orm/mysql-core";
import {
  bankTransfers,
  bloodlineRolls,
  conceptImage,
  conversation,
  conversationComment,
  forumPost,
  forumThread,
  historicalAvatar,
  jutsu,
  questHistory,
  user2conversation,
  userAttribute,
  userData,
  userItem,
  userJutsu,
  userPet,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

/** Scan with consistent reads, then recheck eligibility in indexed write batches. */
export const deleteCleanupCandidates = async (
  client: Pick<DrizzleClient, "selectDistinct" | "execute">,
  table: MySqlTable,
  key: Record<string, AnyMySqlColumn<{ data: string | number; notNull: true }>>,
  predicate: SQL | undefined,
  batchSize = 1000,
  indexName = "PRIMARY",
) => {
  if (!predicate) throw new Error("Cleanup requires an eligibility predicate");
  const columns = Object.entries(key);
  const firstColumn = columns[0];
  if (!firstColumn) throw new Error("Cleanup requires an indexed key");
  const [firstName, firstKey] = firstColumn;
  let cursor: Record<string, string | number> | undefined;
  while (true) {
    const previous = cursor;
    const candidates = await client
      .selectDistinct(key)
      .from(table)
      .where(
        and(
          predicate,
          previous &&
            or(
              ...columns.map(([name, column], index) =>
                and(
                  ...columns
                    .slice(0, index)
                    .map(([prefix, prefixColumn]) =>
                      eq(prefixColumn, cleanupKeyValue(previous, prefix)),
                    ),
                  gt(column, cleanupKeyValue(previous, name)),
                ),
              ),
            ),
        ),
      )
      .orderBy(...columns.map(([, column]) => column))
      .limit(batchSize);
    if (!candidates.length) return;

    // Drizzle's DELETE builder cannot force an index. Keep the target access on
    // the selected key even when the optimizer estimates a scan is cheaper: scanned rows
    // are locked under REPEATABLE READ, including rows the predicate excludes.
    const selected =
      columns.length === 1
        ? inArray(
            firstKey,
            candidates.map((row) => cleanupKeyValue(row, firstName)),
          )
        : or(
            ...candidates.map((row) =>
              and(
                ...columns.map(([name, column]) =>
                  eq(column, cleanupKeyValue(row, name)),
                ),
              ),
            ),
          );
    await retryOnDeadlock(() =>
      client.execute(sql`DELETE ${table} FROM ${table} FORCE INDEX (${sql.identifier(indexName)})
        WHERE ${and(selected, predicate)}`),
    );
    // Keyset progress also skips candidates rescued between the read and write.
    cursor = candidates[candidates.length - 1];
    if (candidates.length < batchSize) return;
  }
};

const cleanupKeyValue = (row: Record<string, string | number>, name: string) => {
  const value = row[name];
  if (value === undefined) throw new Error(`Missing cleanup key ${name}`);
  return value;
};

/** Relational leftovers can wait for the daily timer; active queue repair cannot. */
export const cleanupOrphanRows = async (
  client: Pick<DrizzleClient, "select" | "selectDistinct" | "execute">,
) => {
  const missing = (
    parent: MySqlTable,
    parentKey: AnyMySqlColumn,
    childKey: AnyMySqlColumn,
  ) =>
    notExists(
      client
        .select({ id: sql`/*+ NO_SEMIJOIN() */ ${parentKey}` })
        .from(parent)
        .where(eq(parentKey, childKey))
        .limit(1),
    );
  // Disable antijoin materialization: LIMIT alone can still scan and lock every
  // parent inside DELETE. Recheck only the selected children's indexed parents.
  const withoutUser = (childKey: AnyMySqlColumn) =>
    missing(userData, userData.userId, childKey);
  const sweeps: Array<{
    table: MySqlTable;
    key: Record<string, AnyMySqlColumn<{ data: string | number; notNull: true }>>;
    predicate: SQL;
    indexName?: string;
  }> = [
    {
      table: conversationComment,
      key: { id: conversationComment.id },
      predicate: missing(
        conversation,
        conversation.id,
        conversationComment.conversationId,
      ),
    },
    {
      table: user2conversation,
      key: {
        conversationId: user2conversation.conversationId,
        userId: user2conversation.userId,
      },
      predicate: missing(
        conversation,
        conversation.id,
        user2conversation.conversationId,
      ),
    },
    {
      table: user2conversation,
      key: {
        conversationId: user2conversation.conversationId,
        userId: user2conversation.userId,
      },
      predicate: withoutUser(user2conversation.userId),
    },
    {
      table: userJutsu,
      key: { id: userJutsu.id },
      predicate: missing(jutsu, jutsu.id, userJutsu.jutsuId),
    },
    // Transfers have no row id or unique key. Restrict each write to selected
    // indexed sender/receiver pairs. A pair can contain multiple historical transfers.
    {
      table: bankTransfers,
      key: { senderId: bankTransfers.senderId, receiverId: bankTransfers.receiverId },
      predicate: withoutUser(bankTransfers.senderId),
      indexName: "BankTransfers_senderId_receiverId_idx",
    },
    {
      table: bankTransfers,
      key: { senderId: bankTransfers.senderId, receiverId: bankTransfers.receiverId },
      predicate: withoutUser(bankTransfers.receiverId),
      indexName: "BankTransfers_senderId_receiverId_idx",
    },
    { table: userPet, key: { id: userPet.id }, predicate: withoutUser(userPet.userId) },
    {
      table: bloodlineRolls,
      key: { id: bloodlineRolls.id },
      predicate: withoutUser(bloodlineRolls.userId),
    },
    {
      table: conceptImage,
      key: { id: conceptImage.id },
      predicate: withoutUser(conceptImage.userId),
    },
    {
      table: forumThread,
      key: { id: forumThread.id },
      predicate: withoutUser(forumThread.userId),
    },
    {
      table: forumPost,
      key: { id: forumPost.id },
      predicate: withoutUser(forumPost.userId),
    },
    {
      table: forumPost,
      key: { id: forumPost.id },
      predicate: missing(forumThread, forumThread.id, forumPost.threadId),
    },
    {
      table: historicalAvatar,
      key: { id: historicalAvatar.id },
      predicate: withoutUser(historicalAvatar.userId),
    },
    {
      table: questHistory,
      key: { id: questHistory.id },
      predicate: withoutUser(questHistory.userId),
    },
    {
      table: userAttribute,
      key: { id: userAttribute.id },
      predicate: withoutUser(userAttribute.userId),
    },
    {
      table: userJutsu,
      key: { id: userJutsu.id },
      predicate: withoutUser(userJutsu.userId),
    },
    {
      table: userItem,
      key: { id: userItem.id },
      predicate: withoutUser(userItem.userId),
    },
  ];
  // Keep full-table consistent scans sequential to avoid saturating the database.
  for (const sweep of sweeps) {
    await deleteCleanupCandidates(
      client,
      sweep.table,
      sweep.key,
      sweep.predicate,
      1000,
      sweep.indexName,
    );
  }
};
