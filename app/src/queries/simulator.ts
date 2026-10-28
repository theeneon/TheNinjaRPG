/**
 * Database access for simulator; authorization and transaction scopes stay in callers.
 */
import { desc, eq } from "drizzle-orm";
import { damageSimulation } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Build the `damageSimulation` lookup, using predicates on `id`. */
export const findDamageSimulationById = (client: DrizzleClient, id: string) =>
  client.query.damageSimulation.findFirst({
    where: eq(damageSimulation.id, id),
    orderBy: [desc(damageSimulation.createdAt)],
  });

import { and, gt } from "drizzle-orm";
import { nanoid } from "nanoid";

/** Build the `damageSimulation` listing for `getDamageSimulations`, using predicates on `userId`. */
export const listDamageSimulationForGetDamageSimulations = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.damageSimulation.findMany({
    where: eq(damageSimulation.userId, ctx.userId),
    orderBy: [desc(damageSimulation.createdAt)],
  });

/**
 * Build the `damageSimulation` listing for `createDamageSimulation`, selecting only
 * `id` and `createdAt`, using predicates on `userId`.
 */
export const listDamageSimulationForCreateDamageSimulation = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  maxEntries: 20,
) =>
  client.query.damageSimulation.findMany({
    columns: { id: true, createdAt: true },
    where: eq(damageSimulation.userId, ctx.userId),
    orderBy: [desc(damageSimulation.createdAt)],
    limit: maxEntries + 1,
  });

/** Build the `damageSimulation` insert for `createDamageSimulation`. */
export const insertDamageSimulationForCreateDamageSimulation = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: import("@/validators/combat").DamageSimulationState,
) =>
  client.insert(damageSimulation).values({
    id: nanoid(),
    userId: ctx.userId,
    state: input,
  });

/** Build the `damageSimulation` deletion for `createDamageSimulation`, using predicates on `userId` and `createdAt`. */
export const deleteDamageSimulationForCreateDamageSimulation = (
  client: Pick<DrizzleClient, "delete">,
  ctx: { userId: string },
  lastEntry: { createdAt: Date },
) =>
  client
    .delete(damageSimulation)
    .where(
      and(
        eq(damageSimulation.userId, ctx.userId),
        gt(damageSimulation.createdAt, lastEntry.createdAt),
      ),
    );

/**
 * Build the `damageSimulation` update for `updateDamageSimulation`, setting `active`,
 * using predicates on `id` and `userId`.
 */
export const updateDamageSimulationForUpdateDamageSimulation = (
  client: Pick<DrizzleClient, "update">,
  input: { active: false | true; id: string },
  ctx: { userId: string },
) =>
  client
    .update(damageSimulation)
    .set({ active: input.active ? 1 : 0 })
    .where(
      and(eq(damageSimulation.id, input.id), eq(damageSimulation.userId, ctx.userId)),
    );

/** Build the `damageSimulation` update for `updateDamageSimulation`, setting `active`, using predicates on `userId`. */
export const updateDamageSimulationForUpdateDamageSimulation2 = (
  client: Pick<DrizzleClient, "update">,
  input: { active: false | true },
  ctx: { userId: string },
) =>
  client
    .update(damageSimulation)
    .set({ active: input.active ? 1 : 0 })
    .where(eq(damageSimulation.userId, ctx.userId));

/** Build the `damageSimulation` deletion for `deleteDamageSimulation`, using predicates on `id`. */
export const deleteDamageSimulationForDeleteDamageSimulation = (
  client: Pick<DrizzleClient, "delete">,
  entry: { id: string },
) => client.delete(damageSimulation).where(eq(damageSimulation.id, entry.id));
