/**
 * Database access for pet species; authorization and transaction scopes stay in callers.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { actionLog, jutsu, petSpecies } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Build the `petSpecies` listing for `getAll`. */
export const listPetSpeciesForGetAll = (client: Pick<DrizzleClient, "query">) =>
  client.query.petSpecies.findMany({ orderBy: asc(petSpecies.name) });

/** Build the `petSpecies` lookup for `get`, using predicates on `id`. */
export const findPetSpeciesForGet = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.petSpecies.findFirst({
    where: eq(petSpecies.id, input.id),
  });

/** Build the `petSpecies` lookup for `create`, using predicates on `name`. */
export const findPetSpeciesForCreate = (
  client: Pick<DrizzleClient, "query">,
  input: { name: string },
) =>
  client.query.petSpecies.findFirst({
    where: eq(petSpecies.name, input.name),
  });

/** Build the `jutsu` listing for `create`, using predicates on `id`. */
export const listJutsuForCreate = (
  client: Pick<DrizzleClient, "query">,
  input: { defaultJutsuIds: string[] },
) =>
  client.query.jutsu.findMany({
    where: inArray(jutsu.id, input.defaultJutsuIds),
  });

/** Build the `petSpecies` insert for `create`. */
export const insertPetSpeciesForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  input: import("@/validators/petSpecies").ZodPetSpeciesType,
) => client.insert(petSpecies).values({ id, ...input });

/** Build the `actionLog` insert for `create`. */
export const insertActionLogForCreate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  changes: string[],
  id: string,
  input: { name: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "petSpecies",
    changes,
    relatedId: id,
    relatedMsg: `Create: ${input.name}`,
  });

/** Build the `petSpecies` lookup for `update`, using predicates on `name`. */
export const findPetSpeciesForUpdate2 = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { name: string } },
) =>
  client.query.petSpecies.findFirst({
    where: eq(petSpecies.name, input.data.name),
  });

/** Build the `jutsu` listing for `update`, using predicates on `id`. */
export const listJutsuForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { defaultJutsuIds: string[] } },
) =>
  client.query.jutsu.findMany({
    where: inArray(jutsu.id, input.data.defaultJutsuIds),
  });

/** Build the `petSpecies` update for `update`, setting `updatedAt`, using predicates on `id`. */
export const updatePetSpeciesForUpdate = (
  client: Pick<DrizzleClient, "update">,
  input: { data: import("@/validators/petSpecies").ZodPetSpeciesType },
  species: { id: string },
) =>
  client
    .update(petSpecies)
    .set({ ...input.data, updatedAt: new Date() })
    .where(eq(petSpecies.id, species.id));

/** Build the `actionLog` insert for `update`. */
export const insertActionLogForUpdate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  changes: string[],
  species: { id: string; name: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "petSpecies",
    changes,
    relatedId: species.id,
    relatedMsg: `Update: ${species.name}`,
  });
