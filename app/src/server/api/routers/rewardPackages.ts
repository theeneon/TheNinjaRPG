import { nanoid } from "nanoid";
import type { UserRole } from "@/drizzle/constants";
import type { rewardPackage } from "@/drizzle/schema";
import { fetchUser } from "@/queries/profile";
import {
  deleteRewardNodeForDeleteNode,
  deleteRewardPackageForDeletePackage,
  findRewardNodeForSaveNode,
  findRewardPackageForSavePackage,
  insertActionLogForDeleteNode,
  insertActionLogForDeletePackage,
  insertActionLogForSaveNode,
  insertActionLogForSavePackage,
  insertRewardNodeForSaveNode,
  insertRewardPackageForSavePackage,
  listRewardNodeForGetCatalog,
  listRewardPackageForGetCatalog,
  updateRewardNodeForSaveNode,
  updateRewardPackageForSavePackage,
} from "@/queries/rewardPackages";

import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import { validateTitleRewardIds } from "@/server/utils/titleRewards";
import { canAwardReputation, canManageRewards, isStaffRole } from "@/utils/permissions";
import { idSchema } from "@/validators/misc";
import type { QuestContentType } from "@/validators/objectives";
import { SaveRewardNode, SaveRewardPackage } from "@/validators/rewardPackages";

/** Staff reward catalog maintenance; reward delivery stays in the quest claim path. */
export const rewardPackagesRouter = createTRPCRouter({
  /** Load both catalogs in parallel after checking staff visibility. */
  getCatalog: protectedProcedure.query(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (!isStaffRole(user.role))
      throw serverError("FORBIDDEN", "Rewards are only available to staff");
    const [packages, nodes] = await Promise.all([
      listRewardPackageForGetCatalog(ctx.drizzle),
      listRewardNodeForGetCatalog(ctx.drizzle),
    ]);
    return { packages, nodes };
  }),
  /** Save and audit a catalog source, preserving reputation amounts for restricted authors. */
  savePackage: protectedProcedure
    .input(SaveRewardPackage)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry, titleError] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        input.id
          ? findRewardPackageForSavePackage(ctx.drizzle, { id: input.id })
          : undefined,
        validateTitleRewardIds(ctx.drizzle, [input.data.rewards]),
      ]);
      if (user.isBanned || !canManageRewards(user.role))
        return errorResponse("Not allowed to maintain reward packages");
      if (input.id && !entry) return errorResponse("Reward package not found");
      if (titleError) return errorResponse(titleError);
      if (
        !canAwardReputation(user.role) &&
        input.data.rewards.reward_reputation !== (entry?.rewards.reward_reputation ?? 0)
      )
        return errorResponse("Not allowed to author reputation rewards");
      const id = entry?.id ?? nanoid();
      await Promise.all([
        entry
          ? updateRewardPackageForSavePackage(ctx.drizzle, input, id)
          : insertRewardPackageForSavePackage(ctx.drizzle, id, input),
        insertActionLogForSavePackage(ctx.drizzle, ctx, id, entry, input),
      ]);
      return { success: true, message: "Reward package saved" };
    }),
  /** Save and audit editor field groupings without changing any saved reward payload. */
  saveNode: protectedProcedure
    .input(SaveRewardNode)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        input.id ? findRewardNodeForSaveNode(ctx.drizzle, { id: input.id }) : undefined,
      ]);
      if (user.isBanned || !canManageRewards(user.role))
        return errorResponse("Not allowed to maintain reward nodes");
      if (input.id && !entry) return errorResponse("Reward node not found");
      const id = entry?.id ?? nanoid();
      await Promise.all([
        entry
          ? updateRewardNodeForSaveNode(ctx.drizzle, input, id)
          : insertRewardNodeForSaveNode(ctx.drizzle, id, input),
        insertActionLogForSaveNode(ctx.drizzle, ctx, id, entry, input),
      ]);
      return { success: true, message: "Reward node saved" };
    }),
  /** Delete only sources unused by visible, unexpired quests, using one guarded statement. */
  deletePackage: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned || !canManageRewards(user.role))
        return errorResponse("Not allowed to delete reward packages");
      // Snapshots retain their payload even if a hidden quest is saved concurrently with deletion.
      const result = await deleteRewardPackageForDeletePackage(ctx.drizzle, input);
      if (result.rowsAffected === 0)
        return errorResponse(
          "Package not found or used by an active quest. Remove it from active quests first.",
        );
      await insertActionLogForDeletePackage(ctx.drizzle, ctx, input);
      return { success: true, message: "Reward package deleted" };
    }),
  /** Remove a catalog grouping; existing rewards remain accessible through fallback groups. */
  deleteNode: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned || !canManageRewards(user.role))
        return errorResponse("Not allowed to delete reward nodes");
      await deleteRewardNodeForDeleteNode(ctx.drizzle, input);
      await insertActionLogForDeleteNode(ctx.drizzle, ctx, input);
      return { success: true, message: "Reward node deleted" };
    }),
});

/**
 * Validate attachment identities, source approval and whole-bundle choice restrictions.
 * Restricted reputation amounts must match the saved snapshot or approved catalog source;
 * copied attachments can retain saved approval under fresh ids after catalog edits or deletion.
 * Independent nodes without a catalog source retain approval only under their own saved id.
 * @returns A recoverable save rejection, or null when every attachment is permitted.
 */
export const validateQuestRewardPackages = (
  content: QuestContentType,
  existing: QuestContentType,
  packages: (typeof rewardPackage.$inferSelect)[],
  role: UserRole,
): string | null => {
  const rewards = [content.reward, ...content.objectives];
  const oldRewards = [existing.reward, ...existing.objectives];
  const snapshots = rewards.flatMap((reward) => reward.reward_packages ?? []);
  const oldSnapshots = oldRewards.flatMap((reward) => reward.reward_packages ?? []);
  if (new Set(snapshots.map((pack) => pack.id)).size !== snapshots.length)
    return "Each package snapshot must have a unique id";
  for (const pack of snapshots) {
    // Catalog copies can match their source; independent nodes must match their exact saved identity.
    const old =
      oldSnapshots.find(
        (saved) => saved.id === pack.id && saved.packageId === pack.packageId,
      ) ??
      (pack.packageId
        ? oldSnapshots.find(
            (saved) =>
              saved.packageId === pack.packageId &&
              (canAwardReputation(role) ||
                saved.rewards.reward_reputation === pack.rewards.reward_reputation),
          )
        : undefined);
    const source = packages.find((source) => source.id === pack.packageId);
    if (pack.packageId && !source && !old)
      return "Reward package no longer exists. Select another package.";
    if (
      !canAwardReputation(role) &&
      pack.rewards.reward_reputation !==
        (old?.rewards.reward_reputation ?? source?.rewards.reward_reputation ?? 0)
    )
      return "Package reputation must match its approved snapshot";
    if (
      pack.rewards.reward_sage_modes.length > 1 &&
      content.rewardMode === "choose" &&
      content.reward.reward_packages?.includes(pack)
    )
      return "A reward choice package can contain at most one sage mode";
  }
  return null;
};
