/**
 * Database access for bounty; authorization and transaction scopes stay in callers.
 */
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  actionLog,
  bounty,
  bountyContribution,
  bountySignup,
  userData,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Build the `bounty` listing for `board`, using predicates on `status` and `collectedAt`. */
export const listBountyForBoard = (
  client: Pick<DrizzleClient, "query">,
  input: { status: "all" | "EXPIRED" | "CANCELLED" | "OPEN" | "CLAIMED" },
  limit: number,
  offset: number,
) =>
  client.query.bounty.findMany({
    where:
      input.status === "all"
        ? undefined
        : input.status === "OPEN"
          ? and(
              inArray(bounty.status, ["OPEN", "CLAIMED"]),
              // Hide completed bounties (CLAIMED and collected)
              or(
                eq(bounty.status, "OPEN"),
                and(eq(bounty.status, "CLAIMED"), isNull(bounty.collectedAt)),
              ),
            )
          : eq(bounty.status, input.status),
    columns: {
      id: true,
      amountRyo: true,
      createdAt: true,
      status: true,
      collectedAt: true,
      claimedAt: true,
      targetUserId: true,
      claimedByUserId: true,
      creatorUserId: true,
    },
    with: {
      target: {
        columns: {
          username: true,
          avatar: true,
          level: true,
          rank: true,
          isOutlaw: true,
          villageId: true,
        },
      },
      hunters: {
        columns: {
          hunterUserId: true,
        },
        with: {
          hunter: {
            columns: {
              username: true,
              avatar: true,
              level: true,
              rank: true,
              isOutlaw: true,
              villageId: true,
            },
          },
        },
      },
      creator: {
        columns: {
          username: true,
          avatar: true,
          level: true,
          rank: true,
          isOutlaw: true,
          villageId: true,
        },
      },
      claimedBy: {
        columns: {
          username: true,
          avatar: true,
          level: true,
          rank: true,
          isOutlaw: true,
          villageId: true,
        },
      },
    },
    orderBy: desc(bounty.createdAt),
    limit,
    offset,
  });

/** Build the `bounty` lookup for `create`, using predicates on `targetUserId` and `status`. */
export const findBountyForCreate = (
  client: Pick<DrizzleClient, "query">,
  targetUserId: string,
) =>
  client.query.bounty.findFirst({
    where: and(eq(bounty.targetUserId, targetUserId), eq(bounty.status, "OPEN")),
  });

/** Build the `bounty` insert for `create`. */
export const insertBountyForCreate = (
  client: Pick<DrizzleClient, "insert">,
  bountyId: string,
  targetUserId: string,
  ctx: { userId: string },
  amountRyo: number,
) =>
  client.insert(bounty).values({
    id: bountyId,
    targetUserId,
    creatorUserId: ctx.userId,
    amountRyo,
    originalAmountRyo: amountRyo,
    status: "OPEN",
    createdAt: new Date(),
  });

/** Build the `bountyContribution` insert for `create`. */
export const insertBountyContributionForCreate = (
  client: Pick<DrizzleClient, "insert">,
  bountyId: string,
  ctx: { userId: string },
  amountRyo: number,
) =>
  client.insert(bountyContribution).values({
    id: nanoid(),
    bountyId,
    contributorUserId: ctx.userId,
    amountRyo,
    createdAt: new Date(),
  });

/** Build a bounty lookup by ID. */
export const findBountyById = (
  client: Pick<DrizzleClient, "query">,
  bountyId: string,
) =>
  client.query.bounty.findFirst({
    where: eq(bounty.id, bountyId),
  });

/** Build the `bountySignup` listing for `signup`, using predicates on `bountyId`. */
export const listBountySignupForSignup = (
  client: Pick<DrizzleClient, "query">,
  bountyId: string,
) =>
  client.query.bountySignup.findMany({
    where: eq(bountySignup.bountyId, bountyId),
  });

/** Build the `bountySignup` lookup for `signup`, using predicates on `hunterUserId`. */
export const findBountySignupForSignup = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.bountySignup.findFirst({
    where: eq(bountySignup.hunterUserId, ctx.userId),
  });

/** Build the `bountySignup` insert for `signup`. */
export const insertBountySignupForSignup = (
  client: Pick<DrizzleClient, "insert">,
  bountyId: string,
  ctx: { userId: string },
) =>
  client.insert(bountySignup).values({
    id: nanoid(),
    bountyId,
    hunterUserId: ctx.userId,
    createdAt: new Date(),
  });

/** Build the `bountySignup` lookup for `resign`, using predicates on `id`. */
export const findBountySignupForResign = (
  client: Pick<DrizzleClient, "query">,
  input: { claimId: string },
) =>
  client.query.bountySignup.findFirst({
    where: eq(bountySignup.id, input.claimId),
  });

/** Build the `bountySignup` deletion for `resign`, using predicates on `id`. */
export const deleteBountySignupForResign = (
  client: Pick<DrizzleClient, "delete">,
  claim: { id: string },
) => client.delete(bountySignup).where(eq(bountySignup.id, claim.id));

/** Build the signup lookup for one bounty and hunter. */
export const findBountySignup = (
  client: Pick<DrizzleClient, "query">,
  bountyId: string,
  userId: string,
) =>
  client.query.bountySignup.findFirst({
    where: and(
      eq(bountySignup.bountyId, bountyId),
      eq(bountySignup.hunterUserId, userId),
    ),
  });

/** Build the `bounty` update for `collect`, setting `collectedAt`, using predicates on `id`. */
export const updateBountyForCollect = (
  client: Pick<DrizzleClient, "update">,
  bountyId: string,
) =>
  client.update(bounty).set({ collectedAt: new Date() }).where(eq(bounty.id, bountyId));

/** Build the `bountySignup` deletion for `collect`, using predicates on `bountyId`. */
export const deleteBountySignupForCollect = (
  client: Pick<DrizzleClient, "delete">,
  bountyId: string,
) => client.delete(bountySignup).where(eq(bountySignup.bountyId, bountyId));

/** Build the `userData` update for `collect`, setting `money`, using predicates on `userId`. */
export const updateUserDataForCollect = (
  client: Pick<DrizzleClient, "update">,
  curBounty: { amountRyo: number },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ money: sql`${userData.money} + ${curBounty.amountRyo}` })
    .where(eq(userData.userId, ctx.userId));

/** Build the `bounty` update for `addMoney`, setting `amountRyo`, using predicates on `id`. */
export const updateBountyForAddMoney = (
  client: Pick<DrizzleClient, "update">,
  input: { amountRyo: number; bountyId: string },
) =>
  client
    .update(bounty)
    .set({ amountRyo: sql`${bounty.amountRyo} + ${input.amountRyo}` })
    .where(eq(bounty.id, input.bountyId));

/** Build the `userData` update for `addMoney`, setting `money`, using predicates on `userId`. */
export const updateUserDataForAddMoney = (
  client: Pick<DrizzleClient, "update">,
  input: { amountRyo: number },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ money: sql`${userData.money} - ${input.amountRyo}` })
    .where(eq(userData.userId, ctx.userId));

/** Build the `bountyContribution` insert for `addMoney`. */
export const insertBountyContributionForAddMoney = (
  client: Pick<DrizzleClient, "insert">,
  input: { bountyId: string; amountRyo: number },
  ctx: { userId: string },
) =>
  client.insert(bountyContribution).values({
    id: nanoid(),
    bountyId: input.bountyId,
    contributorUserId: ctx.userId,
    amountRyo: input.amountRyo,
    createdAt: new Date(),
  });

/** Build the contribution listing for a bounty. */
export const listBountyContributions = (
  client: Pick<DrizzleClient, "query">,
  bountyId: string,
) =>
  client.query.bountyContribution.findMany({
    where: eq(bountyContribution.bountyId, bountyId),
  });

/** Build the `bounty` update for `retract`, setting `status`, using predicates on `id`, `creatorUserId`, `status`. */
export const updateBountyForRetract = (
  client: Pick<DrizzleClient, "update">,
  input: { bountyId: string },
  ctx: { userId: string },
) =>
  client
    .update(bounty)
    .set({ status: "CANCELLED" })
    .where(
      and(
        eq(bounty.id, input.bountyId),
        eq(bounty.creatorUserId, ctx.userId),
        eq(bounty.status, "OPEN"),
      ),
    );

/** Build the `bountySignup` deletion for `retract`, using predicates on `bountyId`. */
export const deleteBountySignupForRetract = (
  client: Pick<DrizzleClient, "delete">,
  input: { bountyId: string },
) => client.delete(bountySignup).where(eq(bountySignup.bountyId, input.bountyId));

/** Build the `bountyContribution` deletion for `retract`, using predicates on `bountyId`. */
export const deleteBountyContributionForRetract = (
  client: Pick<DrizzleClient, "delete">,
  input: { bountyId: string },
) =>
  client
    .delete(bountyContribution)
    .where(eq(bountyContribution.bountyId, input.bountyId));

/** Build the SQL balance increment that returns a bounty contribution without overwriting concurrent credits. */
export const refundBountyContribution = (
  client: Pick<DrizzleClient, "update">,
  contribution: { amountRyo: number; contributorUserId: string },
) =>
  client
    .update(userData)
    .set({ money: sql`${userData.money} + ${contribution.amountRyo}` })
    .where(eq(userData.userId, contribution.contributorUserId));

/** Build the `bounty` lookup for `removeAllTrackers`, using predicates on `id`. */
export const findBountyForRemoveAllTrackers = (
  client: Pick<DrizzleClient, "query">,
  input: { bountyId: string },
) =>
  client.query.bounty.findFirst({
    where: eq(bounty.id, input.bountyId),
    with: {
      hunters: {
        with: {
          hunter: {
            columns: {
              userId: true,
              username: true,
            },
          },
        },
      },
    },
  });

/** Build the `actionLog` insert for `removeAllTrackers`. */
export const insertActionLogForRemoveAllTrackers = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  hunters: (import("@/drizzle/schema").BountySignup & {
    hunter: Pick<import("@/drizzle/schema").UserData, "userId" | "username">;
  })[],
  input: { bountyId: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "bounty",
    changes: [`Removed ${hunters.length} hunters from bounty tracking`],
    relatedId: input.bountyId,
    relatedMsg: `Staff removed all trackers from bounty: ${hunters.length} hunters removed`,
  });

/** Build the `bountySignup` listing for `getTrackedBounties`, using predicates on `hunterUserId`. */
export const listBountySignupForGetTrackedBounties = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.bountySignup.findMany({
    where: eq(bountySignup.hunterUserId, ctx.userId),
    with: {
      bounty: {
        columns: {
          id: true,
          status: true,
          amountRyo: true,
          collectedAt: true,
          claimedAt: true,
        },
        with: {
          target: {
            columns: {
              userId: true,
              username: true,
              avatar: true,
              avatarLight: true,
              sector: true,
            },
          },
        },
      },
    },
  });

/** Build the `bounty` listing for `bountyExpire`, using predicates on `status` and `createdAt`. */
export const listBountyForBountyExpire = (
  client: Pick<DrizzleClient, "query">,
  oneWeekAgo: Date,
) =>
  client.query.bounty.findMany({
    where: and(eq(bounty.status, "OPEN"), lt(bounty.createdAt, oneWeekAgo)),
    with: {
      hunters: true,
    },
  });

/** Build the `bounty` update for `bountyExpire`, setting `status`, using predicates on `id`. */
export const updateBountyForBountyExpire = (
  client: Pick<DrizzleClient, "update">,
  expiredBounty: { id: string },
) =>
  client
    .update(bounty)
    .set({ status: "EXPIRED" })
    .where(eq(bounty.id, expiredBounty.id));

/** Build the `bountySignup` deletion for `bountyExpire`, using predicates on `bountyId`. */
export const deleteBountySignupForBountyExpire = (
  client: Pick<DrizzleClient, "delete">,
  expiredBounty: { id: string },
) => client.delete(bountySignup).where(eq(bountySignup.bountyId, expiredBounty.id));

/** Build the `bountyContribution` deletion for `bountyExpire`, using predicates on `bountyId`. */
export const deleteBountyContributionForBountyExpire = (
  client: Pick<DrizzleClient, "delete">,
  expiredBounty: { id: string },
) =>
  client
    .delete(bountyContribution)
    .where(eq(bountyContribution.bountyId, expiredBounty.id));
