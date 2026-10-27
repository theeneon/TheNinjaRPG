/**
 * Database access for map terrain; authorization and transaction scopes stay in callers.
 */
import { eq } from "drizzle-orm";
import { mapTerrain } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** COMMON QUERIES WHICH ARE REUSED */

/** Fetch a terrain row by id; undefined when it does not exist */
export const fetchMapTerrain = async (client: DrizzleClient, id: string) => {
  return await client.query.mapTerrain.findFirst({ where: eq(mapTerrain.id, id) });
};

import { asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { actionLog } from "@/drizzle/schema";

/** Build the `mapTerrain` listing for `getAll`. */
export const listMapTerrainForGetAll = (client: Pick<DrizzleClient, "query">) =>
  client.query.mapTerrain.findMany({
    columns: { createdByUserId: false },
    orderBy: [asc(mapTerrain.key)],
  });

/** Build the `mapTerrain` lookup for `get`, using predicates on `id`. */
export const findMapTerrainForGet = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.mapTerrain.findFirst({
    columns: { createdByUserId: false },
    where: eq(mapTerrain.id, input.id),
  });

/** Build the `mapTerrain` insert for `create`. */
export const insertMapTerrainForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  ctx: { userId: string },
) =>
  client.insert(mapTerrain).values({
    id,
    key: `new.terrain.${id.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
    name: "New Terrain",
    colors: ["#48bd48", "#37aa37", "#239623"],
    swatchColor: "#37aa37",
    battleBiome: "ground",
    createdByUserId: ctx.userId,
  });

/** Build the `mapTerrain` lookup for `update`, selecting only `id` and `key`, using predicates on `key`. */
export const findMapTerrainForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { key: string } },
) =>
  client.query.mapTerrain.findFirst({
    columns: { id: true, key: true },
    where: eq(mapTerrain.key, input.data.key),
  });

/** Build the `mapTerrain` update for `update`, using predicates on `id`. */
export const updateMapTerrainForUpdate = (
  client: Pick<DrizzleClient, "update">,
  input: { data: import("@/validators/mapTerrain").ZodMapTerrainType },
  entry: { id: string },
) => client.update(mapTerrain).set(input.data).where(eq(mapTerrain.id, entry.id));

/** Build the `actionLog` insert for `update`. */
export const insertActionLogForUpdate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  diff: string[],
  entry: { id: string; name: string; textureUrl: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "mapTerrain",
    changes: diff,
    relatedId: entry.id,
    relatedMsg: `Update: ${entry.name}`,
    relatedImage: entry.textureUrl,
  });

/** Build the `mapTerrain` deletion for `delete`, using predicates on `id`. */
export const deleteMapTerrainForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(mapTerrain).where(eq(mapTerrain.id, input.id));

/** Build the `actionLog` insert for `delete`. */
export const insertActionLogForDelete = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  entry: { name: string; key: string; id: string; textureUrl: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "mapTerrain",
    changes: [`Deleted terrain ${entry.name} (${entry.key})`],
    relatedId: entry.id,
    relatedMsg: `Delete: ${entry.name}`,
    relatedImage: entry.textureUrl,
  });
