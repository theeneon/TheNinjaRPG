import { eq, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { GameAssetTypes } from "@/drizzle/constants";
import { gameAsset } from "@/drizzle/schema";
import {
  deletedReason,
  editedReason,
  outdateProposalsFor,
} from "@/libs/contentReview/outdate";
import { callDiscordContent } from "@/libs/socials";
import {
  deleteGameAssetForDelete,
  fetchGameAsset,
  insertActionLogForDelete,
  insertActionLogForUpdate,
  insertGameAssetForCreate,
  listGameAssetForGetAllNames,
  listGameAssetForGetNameTags,
  listGameAssetForGetSceneAssets,
  selectDistinctGameAssetTagForGetAllGameAssetContentTagNames,
  selectGameAssetForGetAll,
  selectGameAssetForGetAllFolders,
  updateGameAssetForUpdate,
} from "@/queries/asset";
import { fetchUser } from "@/queries/profile";

import {
  baseServerResponse,
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { gameAssetSchema, gameAssetValidator } from "@/validators/asset";
import { idSchema } from "@/validators/misc";

export const gameAssetRouter = createTRPCRouter({
  getNameTags: publicProcedure
    .meta({ mcp: { description: "Get game asset name tags" } })
    .input(
      z.object({
        type: z.enum(GameAssetTypes).optional(),
        selected: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const whereClauses = [
        ...(input.type ? [eq(gameAsset.type, input.type)] : []),
        ...(input.selected
          ? input.selected.map((t) => like(gameAsset.name, `%${t}%`))
          : []),
      ];
      const names = await listGameAssetForGetNameTags(ctx.drizzle, whereClauses);

      const tokenSet = new Set<string>();
      for (const n of names) {
        if (!n.name) continue;
        const parts = n.name
          .replace(/\d+/g, "")
          .split(/[-_]+/)
          .map((p) => p.trim())
          .filter((p) => p.length > 1);
        for (const p of parts) tokenSet.add(p);
      }
      const tags = Array.from(tokenSet);
      tags.sort((a, b) => a.localeCompare(b));
      return { tags };
    }),
  getAllNames: publicProcedure
    .meta({ mcp: { description: "Get all game asset names" } })
    .input(
      z.object({
        type: z.enum(GameAssetTypes).optional(),
        folderPrefix: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Query
      let assets = await listGameAssetForGetAllNames(ctx.drizzle, input);
      // Filter by folder prefix
      if (input.folderPrefix) {
        assets = assets.map((a) => ({ ...a, name: `${a.folder}/${a.name}` }));
      }
      // Sort by name
      assets.sort((a, b) => a.name.localeCompare(b.name));
      // Return
      return assets;
    }),
  getAllGameAssetContentTagNames: publicProcedure
    .meta({
      mcp: { description: "Get all game asset content tag names" },
    })
    .query(async ({ ctx }) => {
      return await selectDistinctGameAssetTagForGetAllGameAssetContentTagNames(
        ctx.drizzle,
      );
    }),
  getAllFolders: publicProcedure
    .meta({ mcp: { description: "Get all game asset folders" } })
    .input(z.object({ type: z.enum(GameAssetTypes).optional() }).nullish())
    .query(async ({ ctx, input }) => {
      // Return unique folders with counts
      return await selectGameAssetForGetAllFolders(ctx.drizzle, input ?? undefined);
    }),
  getAll: publicProcedure
    .meta({ mcp: { description: "Get all game assets with filtering" } })
    .input(
      gameAssetSchema.extend({
        cursor: z.number().int().min(0).nullish(),
        limit: z.number().int().min(1).max(500),
        nameTokens: z.array(z.string()).optional(),
        includeAnimations: z.boolean().optional(),
        exactFolder: z.string().optional(),
        sort: z.enum(["newest", "oldest", "name-asc", "name-desc"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input?.cursor ? input.cursor : 0;
      const limit = input?.limit ? input.limit : 100;
      const skip = currentCursor * limit;
      const results = await selectGameAssetForGetAll(
        ctx.drizzle,
        input,
        limit + 1,
        skip,
      );

      const nextCursor = results.length > limit ? currentCursor + 1 : null;
      return {
        data: results.slice(0, limit),
        nextCursor: nextCursor,
      };
    }),
  getSceneAssets: publicProcedure
    .meta({ mcp: { description: "Get scene assets by IDs" } })
    .input(z.object({ assetIds: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      return await listGameAssetForGetSceneAssets(ctx.drizzle, input);
    }),
  get: publicProcedure
    .meta({ mcp: { description: "Get a game asset by ID" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const result = await fetchGameAsset(ctx.drizzle, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "gameAsset not found");
      }
      return result;
    }),
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: gameAssetValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchGameAsset(ctx.drizzle, input.id),
      ]);
      if (entry && canChangeContent(user.role)) {
        // Calculate diff
        const diff = calculateContentDiff(entry, {
          id: entry.id,
          createdAt: entry.createdAt,
          ...input.data,
        });
        // Update database
        await Promise.all([
          updateGameAssetForUpdate(ctx.drizzle, input, entry),
          insertActionLogForUpdate(ctx.drizzle, ctx, diff, entry),
        ]);
        await outdateProposalsFor(
          ctx.drizzle,
          "GAME_ASSET",
          [entry.id],
          editedReason("GAME_ASSET", entry.name, user.username),
        );
        if (process.env.NODE_ENV !== "development") {
          await callDiscordContent(user.username, entry.name, diff, entry.image);
        }
        return { success: true, message: `Data updated: ${diff.join(". ")}` };
      } else {
        return { success: false, message: `Not allowed to edit gameAsset` };
      }
    }),
  create: protectedProcedure
    .input(gameAssetValidator.pick({ name: true, type: true, folder: true }).nullish())
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (canChangeContent(user.role)) {
        const id = nanoid();
        await insertGameAssetForCreate(ctx.drizzle, id, ctx, input ?? undefined);
        return { success: true, message: id };
      } else {
        return { success: false, message: `Not allowed to create gameAsset` };
      }
    }),
  delete: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchGameAsset(ctx.drizzle, input.id),
      ]);
      if (entry && canChangeContent(user.role)) {
        await Promise.all([
          deleteGameAssetForDelete(ctx.drizzle, input),
          insertActionLogForDelete(ctx.drizzle, ctx, entry),
        ]);
        await outdateProposalsFor(
          ctx.drizzle,
          "GAME_ASSET",
          [entry.id],
          deletedReason("GAME_ASSET", entry.name, user.username),
        );
        return { success: true, message: `gameAsset deleted` };
      } else {
        return { success: false, message: `Not allowed to delete gameAsset` };
      }
    }),
});
