/**
 * Database access for reward packages; authorization and transaction scopes stay in callers.
 */
import { and, eq, gte, isNull, notExists, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { z } from "zod";
import { actionLog, quest, rewardNode, rewardPackage } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { calculateContentDiff } from "@/utils/diff";
import type { RewardPackageValidator } from "@/validators/rewardPackages";

/** Build the `rewardPackage` listing for `getCatalog`. */
export const listRewardPackageForGetCatalog = (client: Pick<DrizzleClient, "query">) =>
  client.query.rewardPackage.findMany({
    orderBy: (table, { asc }) => [asc(table.name)],
  });

/** Build the `rewardNode` listing for `getCatalog`. */
export const listRewardNodeForGetCatalog = (client: Pick<DrizzleClient, "query">) =>
  client.query.rewardNode.findMany({
    orderBy: (table, { asc }) => [asc(table.name)],
  });

/** Build the `rewardPackage` lookup for `savePackage`, using predicates on `id`. */
export const findRewardPackageForSavePackage = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.rewardPackage.findFirst({
    where: eq(rewardPackage.id, input.id),
  });

/** Build the `rewardPackage` update for `savePackage`, setting `updatedAt`, using predicates on `id`. */
export const updateRewardPackageForSavePackage = (
  client: Pick<DrizzleClient, "update">,
  input: {
    data: z.infer<typeof RewardPackageValidator>;
  },
  id: string,
) =>
  client
    .update(rewardPackage)
    .set({ ...input.data, updatedAt: new Date() })
    .where(eq(rewardPackage.id, id));

/** Build the `rewardPackage` insert for `savePackage`. */
export const insertRewardPackageForSavePackage = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  input: {
    data: z.infer<typeof RewardPackageValidator>;
  },
) => client.insert(rewardPackage).values({ id, ...input.data });

/** Build the `actionLog` insert for `savePackage`. */
export const insertActionLogForSavePackage = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  id: string,
  entry: typeof rewardPackage.$inferSelect | undefined,
  input: {
    data: z.infer<typeof RewardPackageValidator>;
  },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "rewardPackage",
    relatedId: id,
    relatedMsg: `${entry ? "Update" : "Create"}: ${input.data.name}`,
    changes: calculateContentDiff(entry ?? {}, input.data),
  });

/** Build the `rewardNode` lookup for `saveNode`, using predicates on `id`. */
export const findRewardNodeForSaveNode = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.rewardNode.findFirst({
    where: eq(rewardNode.id, input.id),
  });

/** Build the `rewardNode` update for `saveNode`, using predicates on `id`. */
export const updateRewardNodeForSaveNode = (
  client: Pick<DrizzleClient, "update">,
  input: { data: Omit<typeof rewardNode.$inferInsert, "id"> },
  id: string,
) => client.update(rewardNode).set(input.data).where(eq(rewardNode.id, id));

/** Build the `rewardNode` insert for `saveNode`. */
export const insertRewardNodeForSaveNode = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  input: { data: Omit<typeof rewardNode.$inferInsert, "id"> },
) => client.insert(rewardNode).values({ id, ...input.data });

/** Build the `actionLog` insert for `saveNode`. */
export const insertActionLogForSaveNode = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  id: string,
  entry: typeof rewardNode.$inferSelect | undefined,
  input: { data: Omit<typeof rewardNode.$inferInsert, "id"> },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "rewardNode",
    relatedId: id,
    relatedMsg: `${entry ? "Update" : "Create"}: ${input.data.name}`,
    changes: calculateContentDiff(entry ?? {}, input.data),
  });

/** Build the `rewardPackage` deletion for `deletePackage`, including predicates on `id`, `hidden`, `endsAt`. */
export const deleteRewardPackageForDeletePackage = (
  client: Pick<DrizzleClient, "delete" | "select">,
  input: { id: string },
) =>
  client.delete(rewardPackage).where(
    and(
      eq(rewardPackage.id, input.id),
      notExists(
        client
          .select({ id: quest.id })
          .from(quest)
          .where(
            and(
              eq(quest.hidden, false),
              or(isNull(quest.endsAt), gte(quest.endsAt, sql`CURRENT_DATE`)),
              or(
                sql`JSON_CONTAINS(COALESCE(JSON_EXTRACT(${quest.content}, '$.reward.reward_packages[*].packageId'), JSON_ARRAY()), JSON_QUOTE(${input.id})) = 1`,
                sql`JSON_CONTAINS(COALESCE(JSON_EXTRACT(${quest.content}, '$.objectives[*].reward_packages[*].packageId'), JSON_ARRAY()), JSON_QUOTE(${input.id})) = 1`,
              ),
            ),
          ),
      ),
    ),
  );

/** Build the `actionLog` insert for `deletePackage`. */
export const insertActionLogForDeletePackage = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { id: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "rewardPackage",
    relatedId: input.id,
    relatedMsg: "Delete reward package",
    changes: ["Deleted reward package"],
  });

/** Build the `rewardNode` deletion for `deleteNode`, using predicates on `id`. */
export const deleteRewardNodeForDeleteNode = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(rewardNode).where(eq(rewardNode.id, input.id));

/** Build the `actionLog` insert for `deleteNode`. */
export const insertActionLogForDeleteNode = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { id: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "rewardNode",
    relatedId: input.id,
    relatedMsg: "Delete reward node",
    changes: ["Deleted reward node"],
  });
