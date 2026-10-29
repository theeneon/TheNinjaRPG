import { nanoid } from "nanoid";
import { DUNGEON_RUN_SECONDS } from "@/drizzle/constants";
import { transitionCoopParty } from "@/libs/coop";
import { dungeonFloorAt } from "@/libs/dungeon";
import {
  dungeonDropKey,
  dungeonRewardError,
  rollDungeonRewards,
} from "@/libs/dungeonRewards";
import { listAiUserIds } from "@/queries/ai";
import {
  clearDungeonActiveUsers,
  deleteDungeonMemberForUpdateParty,
  deleteDungeonRunForCreate,
  findDungeonForCreate,
  findDungeonMemberForClaim,
  findDungeonMemberForCreate,
  findDungeonRunForAct,
  findMapAssetForSave,
  findUserDataForGetAvailable,
  insertActionLogForSave,
  insertDungeonForSave,
  insertDungeonMember,
  insertDungeonRunForCreate,
  listBattleForGetState,
  listDungeonForGetAvailable,
  listDungeonMemberForAct,
  listDungeonMemberForGetState,
  listDungeonRewardHistory,
  listDungeonRunForGetState,
  listItemForSave,
  listJutsuForSave,
  listRewardPackageForSave,
  listUserDataForGetState,
  lockDungeonRewardUser,
  selectCandidatesForGetState,
  selectDungeonMemberForGetState,
  updateDungeonMemberForClaim,
  updateDungeonRewardReceipt,
  updateDungeonRunForReserve,
  updateDungeonRunForUpdateParty,
} from "@/queries/dungeon";
import { findUserById, findUserRoleById } from "@/queries/profile";
import { initiateBattle } from "@/routers/combat";
import { updateRewards } from "@/routers/quests";
import {
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  ratelimitMiddleware,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { launchCoopEncounter } from "@/server/utils/coop";
import { expireDungeonRun, rollbackDungeonStart } from "@/server/utils/dungeon";
import { notifyMapLocationsChanged } from "@/server/utils/mapLocations";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { canChangeContent } from "@/utils/permissions";
import { secondsFromNow } from "@/utils/time";
import {
  dungeonActionSchema,
  dungeonContentSchema,
  dungeonIdSchema,
  dungeonSectorSchema,
  saveDungeonSchema,
} from "@/validators/dungeon";

/** Party state is versioned; active membership and completion receipts guard cross-run effects. */
export const dungeonRouter = createTRPCRouter({
  /** List visible, unexpired definitions only for the player's current sector. */
  getAvailable: protectedProcedure
    .input(dungeonSectorSchema)
    .query(async ({ ctx, input }) => {
      const [user, definitions] = await Promise.all([
        findUserDataForGetAvailable(ctx.drizzle, ctx),
        listDungeonForGetAvailable(ctx.drizzle),
      ]);
      if (user?.sector !== input.sector) return [];
      return definitions.filter(
        (d) =>
          !d.content.hidden &&
          d.content.sector === user?.sector &&
          (!d.content.expiresAt ||
            new Date(d.content.expiresAt).getTime() > Date.now()),
      );
    }),
  /** Load parties and receipts, expiring deadlines and recovering interrupted floor starts. */
  getState: protectedProcedure.query(async ({ ctx }) => {
    // A derived UNION materializes indexed candidates once; IN can become a dependent
    // subquery that scans every historical run before probing membership.
    const candidates = selectDungeonMemberForGetState(ctx.drizzle, ctx);
    const runs = await selectCandidatesForGetState(ctx.drizzle, candidates, ctx);
    const expiryNeedsRefresh = await Promise.all(
      runs.map((run) => expireDungeonRun(ctx.drizzle, run)),
    );
    const ids = [
      ...new Set(runs.flatMap((r) => [...r.state.memberIds, ...r.state.invitedIds])),
    ];
    const [users, members, refreshedRuns] = await Promise.all([
      ids.length ? listUserDataForGetState(ctx.drizzle, ids) : [],
      runs.length ? listDungeonMemberForGetState(ctx.drizzle, runs) : [],
      expiryNeedsRefresh.some(Boolean)
        ? listDungeonRunForGetState(ctx.drizzle, runs)
        : null,
    ]);
    // Selection prioritizes active parties; the response keeps its chronological ordering.
    let currentRuns =
      refreshedRuns ??
      [...runs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const interrupted = currentRuns.filter(
      (r) =>
        r.status === "FIGHTING" &&
        r.battleId &&
        r.state.entryStartedAt &&
        Date.now() - r.state.entryStartedAt > 60000,
    );
    if (interrupted.length) {
      const battles = await listBattleForGetState(ctx.drizzle, interrupted);
      const missing = interrupted.filter(
        (r) => !battles.some((b) => b.id === r.battleId),
      );
      await Promise.all(
        missing.map((r) =>
          rollbackDungeonStart(
            ctx.drizzle,
            {
              ...r,
              expiresAt: r.state.entryPreviousDeadline
                ? new Date(r.state.entryPreviousDeadline)
                : null,
            },
            r.battleId as string,
            r.version,
          ),
        ),
      );
      if (missing.length)
        currentRuns = await listDungeonRunForGetState(ctx.drizzle, currentRuns);
    }
    return {
      runs: currentRuns,
      users,
      members: members.filter((m) => m.userId === ctx.userId),
      serverTime: new Date(),
    };
  }),
  /** Staff may inspect hidden and expired definitions when authoring dungeon content. */
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const user = await findUserRoleById(ctx.drizzle, ctx.userId);
    return user && canChangeContent(user.role)
      ? listDungeonForGetAvailable(ctx.drizzle)
      : [];
  }),
  /** Validate sources and grant limits, copying approved package snapshots before saving. */
  save: protectedProcedure
    .use(ratelimitMiddleware)
    .input(saveDungeonSchema)
    .mutation(async ({ ctx, input }) => {
      const aiIds = [
        ...new Set(
          input.content.tiers.flatMap((tier) =>
            tier.flatMap((floor) => floor.waves.flatMap((w) => w.aiIds)),
          ),
        ),
      ];
      const drops = input.content.rewards.drops;
      const [user, ais, items, jutsus, entranceAsset, packages] = await Promise.all([
        findUserRoleById(ctx.drizzle, ctx.userId),
        listAiUserIds(ctx.drizzle, aiIds),
        drops.some((d) => d.type === "item" || d.type === "cache")
          ? listItemForSave(ctx.drizzle, drops)
          : [],
        drops.some((d) => d.type === "jutsu")
          ? listJutsuForSave(ctx.drizzle, drops)
          : [],
        input.content.structureAssetId ? findMapAssetForSave(ctx.drizzle, input) : null,
        drops.some((d) => d.type === "package")
          ? listRewardPackageForSave(ctx.drizzle, drops)
          : [],
      ]);
      if (!user || !canChangeContent(user.role))
        return errorResponse("You cannot edit dungeons.");
      if (input.content.structureAssetId && !entranceAsset)
        return errorResponse(
          "The entrance artwork no longer exists. Choose another asset.",
        );
      if (
        ais.length !== aiIds.length ||
        drops.some(
          (d) =>
            !(
              d.type === "package" ? packages : d.type === "jutsu" ? jutsus : items
            ).some((row) => row.id === d.id),
        )
      )
        return errorResponse("An enemy or reward no longer exists.");
      if (
        drops.some(
          (drop) =>
            drop.type === "cache" &&
            !items
              .find((entry) => entry.id === drop.id)
              ?.effects.some(
                (effect) =>
                  effect.type === "noncombatconsumereward" &&
                  effect.rewardMode === "weightedCache",
              ),
        )
      )
        return errorResponse("Choose a weighted cache for each cache reward.");
      // Only approved catalog data enters the snapshot, regardless of the client's payload.
      const content = {
        ...input.content,
        rewards: {
          ...input.content.rewards,
          drops: drops.map(({ package: _snapshot, ...drop }) => {
            const source =
              drop.type === "package"
                ? packages.find((entry) => entry.id === drop.id)
                : undefined;
            return source
              ? {
                  ...drop,
                  package: {
                    name: source.name,
                    description: source.description,
                    rewards: source.rewards,
                  },
                }
              : drop;
          }),
        },
      };
      const rewardError = dungeonRewardError(content.rewards);
      if (rewardError) return errorResponse(rewardError);
      const id = input.id ?? nanoid();
      await Promise.all([
        insertDungeonForSave(ctx.drizzle, id, content),
        insertActionLogForSave(ctx.drizzle, ctx, id, content),
      ]);
      await notifyMapLocationsChanged();
      return { success: true, message: "Dungeon saved.", id };
    }),
  /** Snapshot an available definition and reserve the leader's sole active membership. */
  create: protectedProcedure
    .use(ratelimitMiddleware)
    .input(dungeonIdSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, definition, active] = await Promise.all([
        findUserById(ctx.drizzle, ctx.userId),
        findDungeonForCreate(ctx.drizzle, input),
        findDungeonMemberForCreate(ctx.drizzle, ctx),
      ]);
      if (user?.status !== "AWAKE" || user.isBanned || user.isAi)
        return errorResponse(
          "You must be awake and out of combat to create a dungeon lobby.",
        );
      if (active) return errorResponse("Finish or leave your current dungeon first.");
      const content = definition && dungeonContentSchema.parse(definition.content);
      if (
        !definition ||
        !content ||
        content.hidden ||
        (content.expiresAt && content.expiresAt.getTime() <= Date.now())
      )
        return errorResponse("This dungeon is unavailable.");
      if (user.sector !== content.sector)
        return errorResponse("Travel to the dungeon's sector to create a lobby.");
      const id = nanoid();
      // The unique activeUserId prevents two parties for this account. A crash between
      // inserts can leave only an empty, unreferenced run, which support can remove.
      await insertDungeonRunForCreate(ctx.drizzle, id, definition, ctx, content);
      try {
        await insertDungeonMember(ctx.drizzle, id, ctx.userId);
      } catch (error) {
        // Never remove a run if membership committed despite an ambiguous driver failure.
        await deleteDungeonRunForCreate(ctx.drizzle, id);
        if (isMysqlDuplicateKeyError(error))
          return errorResponse("You already joined another dungeon.");
        throw error;
      }
      return { success: true, message: "Lobby created.", id };
    }),
  /** Apply one party version; membership changes also commit their cross-run reservation. */
  act: protectedProcedure
    .use(ratelimitMiddleware)
    .input(dungeonActionSchema)
    .mutation(async ({ ctx, input }) => {
      const [run, user, target, active] = await Promise.all([
        findDungeonRunForAct(ctx.drizzle, input),
        findUserById(ctx.drizzle, ctx.userId),
        input.userId ? findUserById(ctx.drizzle, input.userId) : undefined,
        listDungeonMemberForAct(ctx.drizzle, ctx, input),
      ]);
      if (!run || !user) return errorResponse("Dungeon not found.");
      if (run.expiresAt && run.expiresAt.getTime() <= Date.now()) {
        await expireDungeonRun(ctx.drizzle, run);
        return errorResponse("The dungeon deadline expired.");
      }
      const { action } = input;
      const transition = transitionCoopParty(
        "dungeon",
        {
          ...run.state,
          leaderId: run.leaderId,
          isPublic: false,
          phase: run.status,
        },
        ctx.userId,
        action === "accept" ? "join" : action,
        input.userId,
      );
      if (!transition.success) return errorResponse(transition.message);
      if (action === "invite") {
        if (!target || target.isAi || target.isBanned || target.status !== "AWAKE")
          return errorResponse("Invite someone who is awake and out of combat.");
        if (active.some((m) => m.activeUserId === target.userId))
          return errorResponse("That player is already in a dungeon.");
      }
      if (
        ["accept", "ready", "unready"].includes(action) &&
        (user.status !== "AWAKE" || user.isBanned || user.isAi)
      )
        return errorResponse(
          "You must be awake and out of combat to join or ready up.",
        );
      if (action === "accept" && active.some((m) => m.activeUserId === ctx.userId))
        return errorResponse("You are already in a dungeon.");
      const { party, removedUserId: removedUser, ended: ending } = transition;
      const joined = !!transition.joinedUserId;
      const state = {
        ...run.state,
        memberIds: party.memberIds,
        invitedIds: party.invitedIds,
        readyIds: party.readyIds,
        ...(ending ? { message: "A party member abandoned the dungeon." } : {}),
      };
      const status =
        party.phase === "STARTING" || party.phase === "ACTIVE"
          ? run.status
          : party.phase;
      if (action === "start") {
        const floor = dungeonFloorAt(run.content, state.floor);
        if (!floor) return errorResponse("This floor is unavailable.");
        const expiresAt = run.expiresAt ?? secondsFromNow(DUNGEON_RUN_SECONDS);
        return launchCoopEncounter({
          reserve: async ({ battleId }) => {
            const claimed = await updateDungeonRunForReserve(
              ctx.drizzle,
              battleId,
              expiresAt,
              run,
              state,
            );
            return claimed.rowsAffected === 1;
          },
          initiate: ({ battleId }) =>
            initiateBattle(
              {
                client: ctx.drizzle,
                userIds: state.memberIds,
                targetIds: floor.waves.flatMap((w) => w.aiIds),
                biome: run.content.background,
                forceKeepPools: true,
                autoCombatFromDefaults: true,
                coop: {
                  kind: "dungeon",
                  battleId,
                  runId: run.id,
                  runVersion: run.version + 1,
                  runState: state,
                  totalFloors: run.content.tiers.flat().length,
                  roomKind: floor.kind,
                  expiresAt: expiresAt.getTime(),
                  waves: floor.waves,
                },
              },
              "QUEST",
              0,
            ),
          recover: ({ battleId }) =>
            rollbackDungeonStart(ctx.drizzle, run, battleId, run.version + 1),
        });
      }

      /** Keep the run's member list consistent with each member's unique active reservation. */
      const updateParty = async (
        client: Pick<DrizzleClient, "update" | "insert" | "delete">,
      ) => {
        const claim = await updateDungeonRunForUpdateParty(client, state, status, run);
        if (claim.rowsAffected !== 1) return false;
        if (joined) await insertDungeonMember(client, run.id, ctx.userId);
        if (removedUser)
          await deleteDungeonMemberForUpdateParty(client, run, removedUser);
        if (ending) await clearDungeonActiveUsers(client, run.id);
        return true;
      };
      try {
        // Roster changes span the run and unique activeUserId reservation. Neither row's
        // guard alone can keep them consistent after failure; use a short transaction only
        // for these changes. Invitations, readiness and pause/resume need just the run CAS.
        const saved = await retryOnDeadlock(() =>
          joined || removedUser || ending
            ? ctx.drizzle.transaction(updateParty)
            : updateParty(ctx.drizzle),
        );
        return saved
          ? { success: true, message: "Party updated." }
          : errorResponse("The party changed. Refresh and try again.");
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse("That player joined another dungeon.");
        throw error;
      }
    }),
  /** Deliver one complete-pyramid roll per member; repeat claims return its saved receipt. */
  claim: protectedProcedure
    .use(ratelimitMiddleware)
    .input(dungeonIdSchema)
    .mutation(async ({ ctx, input }) => {
      const [run, member, user] = await Promise.all([
        findDungeonRunForAct(ctx.drizzle, input),
        findDungeonMemberForClaim(ctx.drizzle, input, ctx),
        findUserById(ctx.drizzle, ctx.userId),
      ]);
      if (!run || !member || !user || !run.state.memberIds.includes(ctx.userId))
        return errorResponse("You are not in this party.");
      if (member.reward)
        return {
          success: true,
          message: "Rewards already delivered.",
          reward: member.reward,
        };
      if (
        run.status !== "COMPLETED" ||
        run.state.clearedFloors.length !== run.content.tiers.flat().length
      )
        return errorResponse("Clear the entire dungeon to collect rewards.");
      const rewards = run.content.rewards;
      const rewardError = dungeonRewardError(rewards);
      if (rewardError) return errorResponse(rewardError);
      // Item/jutsu inserts and village grants cannot share one guarded statement with
      // the receipt. The transaction also serializes cross-run drop history per player.
      const receipt = await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          await lockDungeonRewardUser(tx, ctx.userId);
          const history = rewards.drops.some((drop) => drop.onlyOnce)
            ? await listDungeonRewardHistory(tx, ctx.userId, run.dungeonId)
            : [];
          const claimedDrops = new Set(
            history.flatMap(({ reward }) => reward?.grantedDrops ?? []),
          );
          const { grantedDrops, ...rolled } = rollDungeonRewards(rewards, claimedDrops);
          const receipt = {
            money: rolled.reward_money,
            experience: rolled.reward_exp,
            tokens: rolled.reward_tokens,
            prestige: rolled.reward_prestige,
            items: rolled.reward_items,
            jutsus: rolled.reward_jutsus,
            rewards: rolled,
            grantedDrops,
          };
          const claim = await updateDungeonMemberForClaim(tx, receipt, run, ctx);
          if (claim.rowsAffected === 0) return null;
          // Reward tasks execute serially inside the driver's rotating transaction session.
          const delivered = await updateRewards({
            client: tx as unknown as DrizzleClient,
            user,
            rewards: rolled,
            reason: `Dungeon: ${run.content.name}`,
            inTransaction: true,
            persistQuestData: false,
            pvpBoostApplied: true,
          });
          // Ownership filtering happens in updateRewards. A skipped jutsu must not
          // consume its one-time eligibility or appear in the delivered receipt.
          if (rolled.reward_jutsus.length > 0) {
            const skippedKeys = new Set(
              rolled.reward_jutsus
                .filter((id) => !delivered.jutsus.some((jutsu) => jutsu.id === id))
                .map((id) => dungeonDropKey({ type: "jutsu", id })),
            );
            if (skippedKeys.size > 0) {
              receipt.jutsus = delivered.jutsus.map((jutsu) => jutsu.id);
              receipt.rewards.reward_jutsus = receipt.jutsus;
              receipt.grantedDrops = grantedDrops.filter(
                (key) => !skippedKeys.has(key),
              );
              await updateDungeonRewardReceipt(tx, run.id, ctx.userId, receipt);
            }
          }
          return receipt;
        }),
      );
      return receipt
        ? { success: true, message: "Completion rewards delivered.", reward: receipt }
        : errorResponse("Rewards were already claimed. Refresh to view your receipt.");
    }),
});
