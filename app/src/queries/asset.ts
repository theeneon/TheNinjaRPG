/**
 * Database access for asset; authorization and transaction scopes stay in callers.
 */
import type { SQL } from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { GameAssetType } from "@/drizzle/constants";
import { gameAsset } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/**
 * COMMON QUERIES WHICH ARE REUSED
 */

export const fetchGameAsset = async (client: DrizzleClient, id: string) => {
  return await client.query.gameAsset.findFirst({
    where: eq(gameAsset.id, id),
  });
};

import { and, desc, getTableColumns, inArray, like, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { actionLog, contentTag, gameAssetTag } from "@/drizzle/schema";

/** Build the `gameAsset` listing for `getNameTags`, selecting only `name`, using the configured predicates. */
export const listGameAssetForGetNameTags = (
  client: Pick<DrizzleClient, "query">,
  whereClauses: SQL<unknown>[],
) =>
  client.query.gameAsset.findMany({
    columns: { name: true },
    where: and(...whereClauses),
  });

/** Build the `gameAsset` listing for `getAllNames`, using predicates on `type`. */
export const listGameAssetForGetAllNames = (
  client: Pick<DrizzleClient, "query">,
  input: {
    type?: GameAssetType | undefined;
  },
) =>
  client.query.gameAsset.findMany({
    columns: { id: true, name: true, image: true, folder: true },
    where: input.type ? eq(gameAsset.type, input.type) : undefined,
  });

/** Build the `gameAssetTag` distinct selection for `getAllGameAssetContentTagNames`. */
export const selectDistinctGameAssetTagForGetAllGameAssetContentTagNames = (
  client: Pick<DrizzleClient, "selectDistinct">,
) =>
  client
    .selectDistinct({ name: contentTag.name })
    .from(gameAssetTag)
    .innerJoin(contentTag, eq(gameAssetTag.tagId, contentTag.id));

/** Build the `gameAsset` selection for `getAllFolders`, using predicates on `folder`. */
export const selectGameAssetForGetAllFolders = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      folder: gameAsset.folder,
      count: sql`count(*)`.mapWith(Number),
    })
    .from(gameAsset)
    .where(sql`${gameAsset.folder} != ''`)
    .groupBy(gameAsset.folder)
    .orderBy(gameAsset.folder);

/** Build the `gameAsset` selection for `getAll`, using predicates on `name`, `type`, `folder`. */
export const selectGameAssetForGetAll = (
  client: Pick<DrizzleClient, "select">,
  input: {
    name?: undefined | string;
    type?: GameAssetType | undefined;
    tags?: undefined | string[];
    nameTokens?: undefined | string[];
    folder?: undefined | string;
  },
  limit: number,
  skip: number,
) =>
  client
    .select({ ...getTableColumns(gameAsset) })
    .from(gameAsset)
    .leftJoin(gameAssetTag, eq(gameAsset.id, gameAssetTag.assetId))
    .leftJoin(contentTag, eq(gameAssetTag.tagId, contentTag.id))
    .where(
      and(
        ...(input.name ? [like(gameAsset.name, `%${input.name}%`)] : []),
        ...(input.type
          ? [eq(gameAsset.type, input.type)]
          : [ne(gameAsset.type, "ANIMATION")]),
        ...(input.tags ? [inArray(contentTag.name, input.tags)] : []),
        ...(input.nameTokens
          ? input.nameTokens.map((t) => like(gameAsset.name, `%${t}%`))
          : []),
        ...(input.folder ? [like(gameAsset.folder, `%${input.folder}%`)] : []),
      ),
    )
    .groupBy(gameAsset.id)
    .orderBy(desc(gameAsset.name))
    .limit(limit)
    .offset(skip);

/** Build the `gameAsset` listing for `getSceneAssets`, using predicates on `id`. */
export const listGameAssetForGetSceneAssets = (
  client: Pick<DrizzleClient, "query">,
  input: { assetIds: string[] },
) =>
  client.query.gameAsset.findMany({
    where: inArray(gameAsset.id, input.assetIds),
  });

/** Build the `gameAsset` update for `update`, using predicates on `id`. */
export const updateGameAssetForUpdate = (
  client: Pick<DrizzleClient, "update">,
  input: { data: import("@/validators/asset").ZodGameAssetType },
  entry: { id: string },
) => client.update(gameAsset).set(input.data).where(eq(gameAsset.id, entry.id));

/** Build the `actionLog` insert for `update`. */
export const insertActionLogForUpdate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  diff: string[],
  entry: { id: string; name: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "gameAsset",
    changes: diff,
    relatedId: entry.id,
    relatedMsg: `Update: ${entry.name}`,
    relatedImage: entry.image,
  });

/** Build the `gameAsset` insert for `create`. */
export const insertGameAssetForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  ctx: { userId: string },
) =>
  client.insert(gameAsset).values({
    id: id,
    name: "Placeholder",
    type: "STATIC",
    image: IMG_AVATAR_DEFAULT,
    url: IMG_AVATAR_DEFAULT,
    createdByUserId: ctx.userId,
  });

/** Build the `gameAsset` deletion for `delete`, using predicates on `id`. */
export const deleteGameAssetForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(gameAsset).where(eq(gameAsset.id, input.id));

/** Build the `actionLog` insert for `delete`. */
export const insertActionLogForDelete = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  entry: { name: string; id: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "gameAsset",
    changes: [`Deleted: ${entry.name}`],
    relatedId: entry.id,
    relatedMsg: `Delete: ${entry.name}`,
    relatedImage: entry.image,
  });
