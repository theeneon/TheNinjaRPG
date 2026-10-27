/**
 * Database access for village mission; authorization and transaction scopes stay in callers.
 */
import {
  and,
  eq,
  exists,
  gte,
  isNotNull,
  isNull,
  lte,
  ne,
  type SQL,
  sql,
} from "drizzle-orm";
import type { VillageMissionTask } from "@/drizzle/constants";
import { quest, userData, village, war } from "@/drizzle/schema";
import { warRaidCombatGuard } from "@/queries/war";
import type { DrizzleClient } from "@/server/db";

/**
 * Build the `village` update for `recordVillageMissionProgress`, setting
 * `missionCounters`, including predicates on `id`, `type`, `activeMission`.
 */
export const updateVillageForRecordVillageMissionProgress = (
  client: Pick<DrizzleClient, "update" | "select">,
  argumentsSql: SQL<unknown>[],
  villageId: string,
  userId: string,
) =>
  client
    .update(village)
    .set({
      missionCounters: sql`JSON_SET(${village.missionCounters}, ${sql.join(argumentsSql, sql`, `)})`,
    })
    .where(
      and(
        eq(village.id, villageId),
        eq(village.type, "VILLAGE"),
        isNotNull(village.activeMission),
        // A player who changed villages while an activity was in flight cannot credit the old village.
        exists(
          client
            .select({ userId: userData.userId })
            .from(userData)
            .where(
              and(
                eq(userData.userId, userId),
                eq(userData.villageId, village.id),
                eq(userData.isOutlaw, false),
              ),
            ),
        ),
      ),
    );

/**
 * Build the locking shrine snapshot derived table; compose it into the damage UPDATE
 * instead of executing a separate read.
 */
export const selectWarForApplyVillageMissionShrineDamage = (
  client: Pick<DrizzleClient, "select">,
  hp:
    | typeof import("@/drizzle/schema").war["attackerShrineHp"]
    | typeof import("@/drizzle/schema").war["defenderShrineHp"],
  status:
    | typeof import("@/drizzle/schema").war["attackerShrineStatus"]
    | typeof import("@/drizzle/schema").war["defenderShrineStatus"],
  canCapture: false | true,
  damage: number,
  warId: string,
) =>
  client
    .select({
      id: war.id,
      hp,
      status,
      shouldCapture: (canCapture
        ? sql<number>`IF(${and(eq(status, "ACTIVE"), lte(hp, damage))}, 1, 0)`
        : sql<number>`0`
      ).as("shouldCapture"),
    })
    .from(war)
    .where(and(eq(war.id, warId), isNull(war.endedAt), warRaidCombatGuard()))
    .limit(1)
    .for("update")
    .as("shrine_snapshot");

/**
 * Build the `userData` selection for `applyVillageMissionShrineDamage`, including
 * predicates on `userId`, `villageId`, `id`.
 */
export const selectUserDataForApplyVillageMissionShrineDamage = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ userId: userData.userId })
    .from(userData)
    .where(
      and(
        eq(userData.userId, userId),
        eq(userData.villageId, village.id),
        eq(userData.isOutlaw, false),
      ),
    );

/** Execute the database statement for `applyVillageMissionShrineDamage`. */
export const executeResultForApplyVillageMissionShrineDamage = (
  client: Pick<DrizzleClient, "execute">,
  snapshot: ReturnType<typeof selectWarForApplyVillageMissionShrineDamage>,
  villageId: null | string,
  eligibleVillage: undefined | SQL<unknown>,
  assignments: SQL<unknown>[],
  warId: string,
) =>
  client.execute(sql`
    UPDATE ${war}
    INNER JOIN ${snapshot} ON ${eq(war.id, snapshot.id)}
    ${villageId ? sql`LEFT JOIN ${village} ON ${eligibleVillage}` : sql``}
    SET ${sql.join(assignments, sql`, `)}
    WHERE ${and(eq(war.id, warId), isNull(war.endedAt), warRaidCombatGuard())}
  `);

/** Build the `village` lookup for `get`, using predicates on `id`. */
export const findVillageForGet = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) => client.query.village.findFirst({ where: eq(village.id, input.id) });

/** Build the `quest` listing for `select`, using predicates on `questType`. */
export const listQuestForSelect = (client: Pick<DrizzleClient, "query">) =>
  client.query.quest.findMany({
    where: eq(quest.questType, "village_mission"),
  });

/** Build the `village` update for `select`, setting `activeMission`, using predicates on `activeMission`. */
export const updateVillageForSelect = (
  client: Pick<DrizzleClient, "update">,
  mission: import("@/validators/villageMission").VillageMission,
  leaderGuard: (
    client: Pick<DrizzleClient, "select">,
    villageId: string,
    userId: string,
    allowStaff?: boolean,
  ) => SQL<unknown> | undefined,
  ctx: { drizzle: import("@/server/db").DrizzleClient; userId: string },
  input: { villageId: string; missionId?: undefined | string },
  current: null | import("@/validators/villageMission").VillageMission,
) =>
  client
    .update(village)
    .set({
      // Copy counters inside the statement so contributions racing selection belong to exactly one mission.
      activeMission: sql`JSON_SET(${JSON.stringify(mission)}, '$.baseline', ${village.missionCounters})`,
    })
    .where(
      and(
        leaderGuard(ctx.drizzle, input.villageId, ctx.userId, !input.missionId),
        current
          ? and(
              sql`JSON_UNQUOTE(JSON_EXTRACT(${village.activeMission}, '$.id')) = ${current.id}`,
              sql`JSON_EXTRACT(${village.activeMission}, '$.rerolled') = false`,
            )
          : isNull(village.activeMission),
      ),
    );

/**
 * Build the `village` update for `cancel`, setting `activeMission`, using predicates
 * on `activeMission`, `userId`, `role`.
 */
export const updateVillageForCancel = (
  client: Pick<DrizzleClient, "update" | "select">,
  leaderGuard: (
    client: Pick<DrizzleClient, "select">,
    villageId: string,
    userId: string,
    allowStaff?: boolean,
  ) => SQL<unknown> | undefined,
  ctx: { drizzle: import("@/server/db").DrizzleClient; userId: string },
  input: { villageId: string; missionId: string },
) =>
  client
    .update(village)
    .set({ activeMission: null })
    .where(
      and(
        leaderGuard(ctx.drizzle, input.villageId, ctx.userId, true),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${village.activeMission}, '$.id')) = ${input.missionId}`,
        exists(
          client
            .select({ userId: userData.userId })
            .from(userData)
            .where(and(eq(userData.userId, ctx.userId), ne(userData.role, "USER"))),
        ),
      ),
    );

/**
 * Build the `village` update for `claim`, setting `tokens` and `activeMission`, using
 * predicates on `activeMission` and `missionCounters`.
 */
export const updateVillageForClaim = (
  client: Pick<DrizzleClient, "update">,
  rewardTokens: number,
  leaderGuard: (
    client: Pick<DrizzleClient, "select">,
    villageId: string,
    userId: string,
    allowStaff?: boolean,
  ) => SQL<unknown> | undefined,
  ctx: { drizzle: import("@/server/db").DrizzleClient; userId: string },
  input: { villageId: string },
  mission: {
    id: string;
    objectives: {
      current: number;
      id: string;
      task: VillageMissionTask;
      description: string;
      value: number;
    }[];
  },
) =>
  client
    .update(village)
    .set({
      tokens: sql`${village.tokens} + ${rewardTokens}`,
      activeMission: null,
    })
    .where(
      and(
        leaderGuard(ctx.drizzle, input.villageId, ctx.userId),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${village.activeMission}, '$.id')) = ${mission.id}`,
        ...mission.objectives.map((objective) =>
          gte(
            sql`COALESCE(JSON_EXTRACT(${village.missionCounters}, ${`$.${objective.task}`}), 0) - COALESCE(JSON_EXTRACT(${village.activeMission}, ${`$.baseline.${objective.task}`}), 0)`,
            objective.value,
          ),
        ),
      ),
    );

/** Build the `userData` selection for `leaderGuard`, using predicates on `userId` and `role`. */
export const selectUserDataForLeaderGuard = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ userId: userData.userId })
    .from(userData)
    .where(and(eq(userData.userId, userId), ne(userData.role, "USER")));

/** Build the `userData` selection for `leaderGuard`, including predicates on `userId`, `villageId`, `id`. */
export const selectUserDataForLeaderGuard2 = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ userId: userData.userId })
    .from(userData)
    .where(
      and(
        eq(userData.userId, userId),
        eq(userData.villageId, village.id),
        eq(userData.isOutlaw, false),
        eq(userData.isBanned, false),
      ),
    );
