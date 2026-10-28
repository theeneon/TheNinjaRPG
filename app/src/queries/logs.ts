/**
 * Database access for logs; authorization and transaction scopes stay in callers.
 */
import { and, eq, inArray, isNotNull, like } from "drizzle-orm";
import type { LogType } from "@/drizzle/constants";
import {
  actionLog,
  bloodline,
  bloodlineRolls,
  userData,
  village,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { canSeeSecretData } from "@/utils/permissions";

/** Build the `userData` lookup for `getContentChanges`, using predicates on `username`. */
export const findUserDataForGetContentChanges = (
  client: Pick<DrizzleClient, "query">,
  input: { username: string },
) =>
  client.query.userData.findFirst({
    where: like(userData.username, `%${input.username}%`),
  });

/** Build the `actionLog` listing for `getContentChanges`, including predicates on `tableName`, `relatedId`, `changes`. */
export const listActionLogForGetContentChanges = (
  client: Pick<DrizzleClient, "query">,
  input: {
    logtype: LogType;
    relatedId?: undefined | string;
    search?: undefined | string;
    username?: undefined | string;
    limit: number;
  },
  user: null | import("@/drizzle/schema").UserData,
  target: undefined | null | import("@/drizzle/schema").UserData,
  skip: number,
) =>
  client.query.actionLog.findMany({
    where: and(
      eq(actionLog.tableName, input.logtype),
      ...(input.relatedId ? [eq(actionLog.relatedId, input.relatedId)] : []),
      ...(input.search ? [like(actionLog.changes, `%${input.search}%`)] : []),
      // Username filtering if allowed
      ...(input.username && user && target && canSeeSecretData(user.role)
        ? [eq(actionLog.userId, target.userId)]
        : []),
    ),
    columns: {
      userId: true,
      createdAt: true,
      changes: true,
      relatedId: true,
      relatedMsg: true,
      relatedImage: true,
    },
    with: {
      user: {
        columns: {
          username: true,
        },
      },
    },
    offset: skip,
    orderBy: (table, { desc }) => desc(table.createdAt),
    limit: input.limit,
  });

/** Build the `bloodline` listing for `getContentChanges`, selecting only `id` and `name`, using predicates on `id`. */
export const listBloodlineForGetContentChanges = (
  client: Pick<DrizzleClient, "query">,
  bloodlineIds: Set<string>,
) =>
  client.query.bloodline.findMany({
    where: inArray(bloodline.id, [...bloodlineIds]),
    columns: { id: true, name: true },
  });

/** Build the `village` listing for `getContentChanges`, selecting only `id` and `name`, using predicates on `id`. */
export const listVillageForGetContentChanges = (
  client: Pick<DrizzleClient, "query">,
  villageIds: Set<string>,
) =>
  client.query.village.findMany({
    where: inArray(village.id, [...villageIds]),
    columns: { id: true, name: true },
  });

/** Build the `bloodlineRolls` listing for `getBloodlineHistory`, using predicates on `userId` and `bloodlineId`. */
export const listBloodlineRollsForGetBloodlineHistory = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
) =>
  client.query.bloodlineRolls.findMany({
    where: and(
      eq(bloodlineRolls.userId, input.userId),
      isNotNull(bloodlineRolls.bloodlineId),
    ),
    with: { bloodline: true },
    orderBy: (table, { desc }) => desc(table.createdAt),
  });

/** Build the `actionLog` lookup, using predicates on `id`. */
export const findActionLogById = (
  client: Pick<DrizzleClient, "query">,
  receiptId: string,
) =>
  client.query.actionLog.findFirst({
    where: eq(actionLog.id, receiptId),
  });
