/**
 * Database access for recruitment; authorization and transaction scopes stay in callers.
 */

import {
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import type { RecruitMilestoneRank, RecruitMilestoneStatus } from "@/drizzle/constants";
import {
  actionLog,
  historicalIp,
  paypalTransaction,
  recruitmentRewards,
  recruitRankMilestone,
  recruitReferral,
  stripePayment,
  userData,
} from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import type { DrizzleClient } from "@/server/db";
import { stripeIsLive } from "@/server/utils/stripe/client";

/** Table alias for buyer user joins, keeping its columns distinct from other participants. */
const buyerUser = alias(userData, "buyerUserData");

/** Table alias for ref transaction joins, keeping its columns distinct from other participants. */
const refTransaction = alias(paypalTransaction, "refTransaction");

/** Table alias for recruiter user joins, keeping its columns distinct from other participants. */
const recruiterUser = alias(userData, "recruiterUserData");

/** Table alias for main transaction joins, keeping its columns distinct from other participants. */
const mainTransaction = alias(paypalTransaction, "mainTransaction");

/** Table alias for recruiter joins, keeping its columns distinct from other participants. */
const recruiter = alias(userData, "stripeReferralRecruiter");

/** Table alias for buyer joins, keeping its columns distinct from other participants. */
const buyer = alias(userData, "stripeReferralBuyer");

/** Build the `mainTransaction` selection for `GET`, including predicates on `reputationPoints`, `amount`, `type`. */
export const selectMainTransactionForGET = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({
      originalTransactionId: mainTransaction.transactionId,
      createdById: mainTransaction.createdById,
      transactionUpdatedDate: mainTransaction.transactionUpdatedDate,
      invoiceId: mainTransaction.invoiceId,
      amount: mainTransaction.amount,
      reputationPoints: mainTransaction.reputationPoints,
      currency: mainTransaction.currency,
      recruiterId: recruiterUser.userId,
      referalTransactionId: refTransaction.transactionId,
    })
    .from(mainTransaction)
    .leftJoin(buyerUser, eq(mainTransaction.createdById, buyerUser.userId))
    .leftJoin(recruiterUser, eq(buyerUser.recruiterId, recruiterUser.userId))
    .leftJoin(
      refTransaction,
      and(
        eq(mainTransaction.invoiceId, refTransaction.invoiceId),
        eq(refTransaction.affectedUserId, buyerUser.recruiterId),
      ),
    )
    .where(
      and(
        gt(mainTransaction.reputationPoints, 0),
        gt(mainTransaction.amount, 0),
        eq(mainTransaction.type, "REP_PURCHASE"),
        eq(mainTransaction.status, "COMPLETED"),
        isNotNull(mainTransaction.invoiceId),
        isNotNull(buyerUser.recruiterId),
        isNull(refTransaction.id),
        gte(mainTransaction.createdAt, buyerUser.createdAt),
      ),
    );

/**
 * Build the `stripePayment` selection for `awardStripeReferralReputation`, including
 * predicates on `id`, `grantedAt`, `reviewRequired`.
 */
export const selectStripePaymentForAwardStripeReferralReputation = (
  client: Pick<DrizzleClient, "select">,
  rewardId: SQL<string>,
) =>
  client
    .select({
      rewardId,
      buyerId: buyer.userId,
      buyerCreatedAt: buyer.createdAt,
      recruiterId: recruiter.userId,
      recruiterCreatedAt: recruiter.createdAt,
      reputationPoints: stripePayment.reputationPoints,
    })
    .from(stripePayment)
    .innerJoin(buyer, eq(buyer.userId, stripePayment.createdById))
    .innerJoin(recruiter, eq(recruiter.userId, buyer.recruiterId))
    .leftJoin(recruitmentRewards, eq(recruitmentRewards.id, rewardId))
    .where(
      and(
        isNull(recruitmentRewards.id),
        isNotNull(stripePayment.grantedAt),
        eq(stripePayment.reviewRequired, false),
        eq(stripePayment.federalStatus, "NONE"),
        eq(
          stripePayment.isSandbox,
          env.NODE_ENV === "production" ? false : !stripeIsLive(),
        ),
        gt(stripePayment.reputationPoints, 0),
        gt(stripePayment.amountCents, 0),
        gte(stripePayment.purchasedAt, buyer.createdAt),
        gte(stripePayment.purchasedAt, recruiter.createdAt),
      ),
    );

/** Build the `recruitmentRewards` insert for `awardStripeReferralReputation`. */
export const insertRecruitmentRewardsForAwardStripeReferralReputation = (
  client: Pick<DrizzleClient, "insert">,
  receipt: { rewardId: string; recruiterId: string; buyerId: string },
  amount: number,
) =>
  client.insert(recruitmentRewards).ignore().values({
    id: receipt.rewardId,
    userId: receipt.recruiterId,
    recruitedUserId: receipt.buyerId,
    amount,
    type: "REPUTATION",
  });

/** Execute the database statement for `awardStripeReferralReputation`. */
export const executePaidForAwardStripeReferralReputation = (
  client: Pick<DrizzleClient, "execute">,
  amount: number,
  receipt: {
    recruiterId: string;
    recruiterCreatedAt: Date;
    buyerId: string;
    buyerCreatedAt: Date;
  },
) =>
  client.execute(sql`
        UPDATE ${userData} AS recruiter
        INNER JOIN ${userData} AS buyer ON buyer.recruiterId = recruiter.userId
        SET recruiter.reputationPoints = recruiter.reputationPoints + ${amount},
          recruiter.reputationPointsTotal = recruiter.reputationPointsTotal + ${amount}
        WHERE recruiter.userId = ${receipt.recruiterId}
          AND recruiter.createdAt = ${receipt.recruiterCreatedAt}
          AND buyer.userId = ${receipt.buyerId}
          AND buyer.createdAt = ${receipt.buyerCreatedAt}
      `);

/** Build the `historicalIp` selection for `checkRecruitSignupEligibility`, using predicates on `ip` and `userId`. */
export const selectHistoricalIpForCheckRecruitSignupEligibility = (
  client: Pick<DrizzleClient, "select">,
  signupIp: string,
  recruitUserId: string,
) =>
  client
    .select({ userId: historicalIp.userId })
    .from(historicalIp)
    .where(and(eq(historicalIp.ip, signupIp), ne(historicalIp.userId, recruitUserId)))
    .limit(1);

/** Build the `userData` selection for `checkRecruitSignupEligibility`, using predicates on `lastIp` and `userId`. */
export const selectUserDataForCheckRecruitSignupEligibility = (
  client: Pick<DrizzleClient, "select">,
  signupIp: string,
  recruitUserId: string,
) =>
  client
    .select({ userId: userData.userId })
    .from(userData)
    .where(and(eq(userData.lastIp, signupIp), ne(userData.userId, recruitUserId)))
    .limit(1);

/** Build the `recruitReferral` lookup for `awardRecruitRankMilestones`, using predicates on `recruitUserId`. */
export const findRecruitReferralForAwardRecruitRankMilestones = (
  client: Pick<DrizzleClient, "query">,
  recruitUserId: string,
) =>
  client.query.recruitReferral.findFirst({
    where: eq(recruitReferral.recruitUserId, recruitUserId),
  });

/**
 * Build the `recruitRankMilestone` selection for `awardRecruitRankMilestones`, using
 * predicates on `recruitUserId` and `rank`.
 */
export const selectRecruitRankMilestoneForAwardRecruitRankMilestones = (
  client: Pick<DrizzleClient, "select">,
  recruitUserId: string,
  reached: (
    | { rank: "GENIN"; reputation: 1 }
    | { rank: "CHUNIN"; reputation: 5 }
    | { rank: "JONIN"; reputation: 10 }
    | { rank: "ELITE JONIN"; reputation: 10 }
  )[],
) =>
  client
    .select({ rank: recruitRankMilestone.rank })
    .from(recruitRankMilestone)
    .where(
      and(
        eq(recruitRankMilestone.recruitUserId, recruitUserId),
        inArray(
          recruitRankMilestone.rank,
          reached.map((m) => m.rank),
        ),
      ),
    );

/**
 * Build the `userData` lookup for `awardRecruitRankMilestones`, selecting only
 * `username` and `avatarLight`, using predicates on `userId`.
 */
export const findUserDataForAwardRecruitRankMilestones2 = (
  client: Pick<DrizzleClient, "query">,
  recruitUserId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, recruitUserId),
    columns: { username: true, avatarLight: true },
  });

/** Build the `recruitRankMilestone` insert for `awardRecruitRankMilestones`. */
export const insertRecruitRankMilestoneForAwardRecruitRankMilestones = (
  client: Pick<DrizzleClient, "insert">,
  recruitUserId: string,
  recruiterId: string,
  outcome: {
    rank: RecruitMilestoneRank;
    status: RecruitMilestoneStatus;
    reputation: number;
  },
) =>
  client.insert(recruitRankMilestone).ignore().values({
    recruitUserId,
    recruiterId,
    rank: outcome.rank,
    status: outcome.status,
    reputationAwarded: outcome.reputation,
  });

/** Build the `userData` update for `awardRecruitRankMilestones`, using predicates on `userId`. */
export const updateUserDataForAwardRecruitRankMilestones = (
  client: Pick<DrizzleClient, "update">,
  outcome: { reputation: number },
  recruiterId: string,
) =>
  client
    .update(userData)
    .set({
      reputationPoints: sql`${userData.reputationPoints} + ${outcome.reputation}`,
      reputationPointsTotal: sql`${userData.reputationPointsTotal} + ${outcome.reputation}`,
      unreadRecruitRewards: sql`LEAST(${userData.unreadRecruitRewards} + 1, 1000)`,
    })
    .where(eq(userData.userId, recruiterId));

/** Build the `recruitmentRewards` insert for `awardRecruitRankMilestones`. */
export const insertRecruitmentRewardsForAwardRecruitRankMilestones = (
  client: Pick<DrizzleClient, "insert">,
  recruiterId: string,
  recruitUserId: string,
  outcome: { reputation: number },
) =>
  client.insert(recruitmentRewards).values({
    id: nanoid(),
    userId: recruiterId,
    recruitedUserId: recruitUserId,
    amount: outcome.reputation,
    type: "RANK_MILESTONE",
  });

/** Build the `actionLog` insert for `awardRecruitRankMilestones`. */
export const insertActionLogForAwardRecruitRankMilestones = (
  client: Pick<DrizzleClient, "insert">,
  recruitUserId: string,
  outcome: { rank: RecruitMilestoneRank; reputation: number },
  recruiterId: string,
  recruit:
    | { username: undefined | string; avatarLight: undefined | null | string }
    | undefined,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: recruitUserId,
    tableName: "user",
    changes: [
      `Recruit reached ${outcome.rank}`,
      `Recruiter ${recruiterId} awarded ${outcome.reputation} reputation points`,
    ],
    relatedId: recruiterId,
    relatedMsg: `Recruit rank milestone: ${recruit?.username ?? recruitUserId} reached ${outcome.rank}`,
    relatedImage: recruit?.avatarLight,
    relatedValue: outcome.reputation,
  });

/** Build the `recruitReferral` selection for `fetchRecruitMilestoneSummary`, using predicates on `recruiterId`. */
export const selectRecruitReferralForFetchRecruitMilestoneSummary = (
  client: Pick<DrizzleClient, "select">,
  recruiterId: string,
) =>
  client
    .select({
      recruitUserId: recruitReferral.recruitUserId,
      isEligible: recruitReferral.isEligible,
      eligibilityReason: recruitReferral.eligibilityReason,
    })
    .from(recruitReferral)
    .where(eq(recruitReferral.recruiterId, recruiterId));

/** Build the `recruitRankMilestone` selection for `fetchRecruitMilestoneSummary`, using predicates on `recruiterId`. */
export const selectRecruitRankMilestoneForFetchRecruitMilestoneSummary = (
  client: Pick<DrizzleClient, "select">,
  recruiterId: string,
) =>
  client
    .select({
      recruitUserId: recruitRankMilestone.recruitUserId,
      rank: recruitRankMilestone.rank,
      status: recruitRankMilestone.status,
      reputationAwarded: recruitRankMilestone.reputationAwarded,
    })
    .from(recruitRankMilestone)
    .where(eq(recruitRankMilestone.recruiterId, recruiterId));
