/**
 * Database access for stealth; authorization and transaction scopes stay in callers.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { STEALTH_SENSORY_CAP } from "@/drizzle/constants";
import { userData, villageAlliance } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/**
 * Build the `userData` update for `activateStealth`, setting `stealthActive` and
 * `stealthActivatedAt`, using predicates on `userId`.
 */
export const updateUserDataForActivateStealth = (
  client: Pick<DrizzleClient, "update">,
  stealthActivatedAt: Date,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      stealthActive: true,
      stealthActivatedAt,
    })
    .where(eq(userData.userId, ctx.userId));

/**
 * Build the `userData` update for `deactivateStealth`, setting `stealthActive` and
 * `stealthActivatedAt`, using predicates on `userId` and `stealthActive`.
 */
export const updateUserDataForDeactivateStealth = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      stealthActive: false,
      stealthActivatedAt: null,
    })
    .where(and(eq(userData.userId, ctx.userId), eq(userData.stealthActive, true)));

/** Build the `userData` listing for `useSensory`, using predicates on `sector`, `stealthActive`, `userId`. */
export const listUserDataForUseSensory = (
  client: Pick<DrizzleClient, "query">,
  input: { sector: number },
  ctx: { userId: string },
) =>
  client.query.userData.findMany({
    where: and(
      eq(userData.sector, input.sector),
      eq(userData.stealthActive, true),
      sql`${userData.userId} != ${ctx.userId}`,
    ),
    columns: {
      userId: true,
      username: true,
      longitude: true,
      latitude: true,
      sector: true,
      avatar: true,
      avatarLight: true,
      location: true,
      villageId: true,
      battleId: true,
      level: true,
      experience: true,
      rank: true,
      status: true,
    },
  });

/** Build the `villageAlliance` selection for `useSensory`. */
export const selectVillageAllianceForUseSensory = (
  client: Pick<DrizzleClient, "select">,
) => client.select().from(villageAlliance);

/** Build the `userData` update for `useSensory`, setting `lastSensoryAt`, using predicates on `userId`. */
export const updateUserDataForUseSensory = (
  client: Pick<DrizzleClient, "update">,
  lastSensoryAt: Date,
  ctx: { userId: string },
) =>
  client.update(userData).set({ lastSensoryAt }).where(eq(userData.userId, ctx.userId));

/**
 * Build the `userData` update for `useSensory`, setting `stealthActive` and
 * `stealthActivatedAt`, using predicates on `userId`.
 */
export const updateUserDataForUseSensory2 = (
  client: Pick<DrizzleClient, "update">,
  detectedUserIds: string[],
) =>
  client
    .update(userData)
    .set({ stealthActive: false, stealthActivatedAt: null })
    .where(inArray(userData.userId, detectedUserIds));

/** Build the `userData` update for `trainCovert`, using predicates on `userId`, `covertTrainingType`, `status`. */
export const updateUserDataForTrainCovert = (
  client: Pick<DrizzleClient, "update">,
  input: { type: "stealth" | "sensory"; minutes: number },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      covertTrainingType: input.type,
      covertTrainingStartedAt: new Date(),
      covertTrainingMinutes: input.minutes,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        isNull(userData.covertTrainingType),
        eq(userData.status, "AWAKE"),
      ),
    );

/** Build the `userData` update for `stopCovertTraining`, using predicates on `userId`. */
export const updateUserDataForStopCovertTraining = (
  client: Pick<DrizzleClient, "update">,
  user: { covertTrainingType: "stealth" | "sensory" },
  gained: number,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      covertTrainingType: null,
      covertTrainingStartedAt: null,
      covertTrainingMinutes: null,
      ...(user.covertTrainingType === "stealth"
        ? {
            stealth: sql`LEAST(${userData.stealth} + ${gained}, ${STEALTH_SENSORY_CAP})`,
          }
        : {
            sensory: sql`LEAST(${userData.sensory} + ${gained}, ${STEALTH_SENSORY_CAP})`,
          }),
    })
    .where(eq(userData.userId, ctx.userId));

/** Build the `userData` update for `cancelCovertTraining`, using predicates on `userId` and `covertTrainingType`. */
export const updateUserDataForCancelCovertTraining = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      covertTrainingType: null,
      covertTrainingStartedAt: null,
      covertTrainingMinutes: null,
    })
    .where(
      and(eq(userData.userId, ctx.userId), isNotNull(userData.covertTrainingType)),
    );

/**
 * Build the `userData` update for `breakStealth`, setting `stealthActive` and
 * `stealthActivatedAt`, using predicates on `userId`.
 */
export const updateUserDataForBreakStealth = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) =>
  client
    .update(userData)
    .set({ stealthActive: false, stealthActivatedAt: null })
    .where(eq(userData.userId, userId));
