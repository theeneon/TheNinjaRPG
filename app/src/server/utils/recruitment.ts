import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  RECRUIT_RANK_MILESTONES,
  type RecruitEligibilityReason,
  type RecruitMilestoneRank,
  type RecruitMilestoneStatus,
  type UserRank,
} from "@/drizzle/constants";
import type { RecruitReferral as RecruitReferralRow } from "@/drizzle/schema";
import {
  actionLog,
  historicalIp,
  recruitmentRewards,
  recruitRankMilestone,
  recruitReferral,
  userData,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { logError } from "@/server/utils/sentry";

/** Position of each rank on the milestone ladder; ranks above Jonin hold every milestone. */
const MILESTONE_LADDER_POSITION: Record<UserRank, number> = {
  STUDENT: 0,
  GENIN: 1,
  CHUNIN: 2,
  JONIN: 3,
  "ELITE JONIN": 3,
  ELDER: 3,
  NONE: 0,
};

/**
 * Milestones a player holding `rank` has reached, lowest first. A promotion that skips a rank
 * still reaches the milestones below it.
 */
export const milestonesReachedAt = (rank: UserRank) =>
  RECRUIT_RANK_MILESTONES.slice(0, MILESTONE_LADDER_POSITION[rank] ?? 0);

/** True when the value is a real client IP rather than a missing-header placeholder. */
export const isKnownIp = (ip: string | null | undefined): ip is string =>
  !!ip && ip.trim() !== "" && ip !== "unknown";

export type RecruitEligibility = {
  isEligible: boolean;
  reason: RecruitEligibilityReason;
};

/**
 * Decide at signup whether a referral may earn rank milestone rewards.
 *
 * The recruit is ineligible when its signup IP is already recorded for any other account
 * (recruiter included) in HistoricalIp or as UserData.lastIp. The recruit's own rows are
 * ignored, and so is anonymous VisitorLog tracking, which every recruit hits before signing
 * up. Without a client IP there is nothing to compare, so the referral stays eligible and the
 * reason records that it was not checked.
 */
export const checkRecruitSignupEligibility = async (props: {
  client: DrizzleClient;
  recruitUserId: string;
  recruiterId: string;
  signupIp: string | null | undefined;
}): Promise<RecruitEligibility> => {
  const { client, recruitUserId, recruiterId, signupIp } = props;
  if (recruiterId === recruitUserId)
    return { isEligible: false, reason: "SELF_REFERRAL" };
  if (!isKnownIp(signupIp)) return { isEligible: true, reason: "IP_UNKNOWN" };
  const [historical, lastIp] = await Promise.all([
    client
      .select({ userId: historicalIp.userId })
      .from(historicalIp)
      .where(and(eq(historicalIp.ip, signupIp), ne(historicalIp.userId, recruitUserId)))
      .limit(1),
    client
      .select({ userId: userData.userId })
      .from(userData)
      .where(and(eq(userData.lastIp, signupIp), ne(userData.userId, recruitUserId)))
      .limit(1),
  ]);
  if (historical.length > 0 || lastIp.length > 0) {
    return { isEligible: false, reason: "SHARED_IP" };
  }
  return { isEligible: true, reason: "IP_NOT_SHARED" };
};

export type RecruitMilestoneOutcome = {
  rank: RecruitMilestoneRank;
  status: RecruitMilestoneStatus;
  reputation: number;
};

/**
 * Record the rank milestones a recruit reaches by holding `rank`, paying the recruiter for
 * each one the first time it is reached by an eligible referral.
 *
 * Call after any write that sets a recruit's rank. Every milestone is a row keyed on
 * (recruit, rank); the INSERT IGNORE of that row is the claim, and the reputation increment,
 * the RecruitmentRewards history row and the ActionLog entry commit in the same transaction,
 * so concurrent promotions, retries, demotion and re-promotion, or a recreated character can
 * never pay a milestone twice. Milestones that are not paid (ineligible referral, missing
 * referral record, deleted recruiter) are still recorded so they can never pay later.
 *
 * Returns the milestones recorded by this call.
 */
export const awardRecruitRankMilestones = async (props: {
  client: DrizzleClient;
  recruitUserId: string;
  recruiterId: string | null | undefined;
  rank: UserRank;
}): Promise<RecruitMilestoneOutcome[]> => {
  const { client, recruitUserId, recruiterId, rank } = props;
  const reached = milestonesReachedAt(rank);
  if (!recruiterId || reached.length === 0) return [];

  // Query
  const [referral, recorded, recruiter, recruit] = await Promise.all([
    client.query.recruitReferral.findFirst({
      where: eq(recruitReferral.recruitUserId, recruitUserId),
    }),
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
      ),
    client.query.userData.findFirst({
      where: eq(userData.userId, recruiterId),
      columns: { userId: true },
    }),
    client.query.userData.findFirst({
      where: eq(userData.userId, recruitUserId),
      columns: { username: true, avatarLight: true },
    }),
  ]);
  const recordedRanks = new Set(recorded.map((r) => r.rank));
  const pending = reached.filter((m) => !recordedRanks.has(m.rank));
  if (pending.length === 0) return [];

  // Decide
  const isEligible = referral?.isEligible ?? false;
  const outcomes: RecruitMilestoneOutcome[] = pending.map((m) => {
    const status: RecruitMilestoneStatus = !isEligible
      ? "INELIGIBLE"
      : !recruiter
        ? "NO_RECRUITER"
        : "PAID";
    return { rank: m.rank, status, reputation: status === "PAID" ? m.reputation : 0 };
  });

  // Mutate
  return retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      const applied: RecruitMilestoneOutcome[] = [];
      for (const outcome of outcomes) {
        const claim = await tx.insert(recruitRankMilestone).ignore().values({
          recruitUserId,
          recruiterId,
          rank: outcome.rank,
          status: outcome.status,
          reputationAwarded: outcome.reputation,
        });
        // Another request recorded this milestone first.
        if (claim.rowsAffected === 0) continue;
        applied.push(outcome);
        if (outcome.status !== "PAID") continue;
        const paid = await tx
          .update(userData)
          .set({
            reputationPoints: sql`${userData.reputationPoints} + ${outcome.reputation}`,
            reputationPointsTotal: sql`${userData.reputationPointsTotal} + ${outcome.reputation}`,
            unreadRecruitRewards: sql`LEAST(${userData.unreadRecruitRewards} + 1, 1000)`,
          })
          .where(eq(userData.userId, recruiterId));
        // The recruiter vanished after the read: roll back so nothing claims a payment.
        if (paid.rowsAffected === 0) {
          throw new Error("Recruiter disappeared while paying a rank milestone");
        }
        await tx.insert(recruitmentRewards).values({
          id: nanoid(),
          userId: recruiterId,
          recruitedUserId: recruitUserId,
          amount: outcome.reputation,
          type: "RANK_MILESTONE",
        });
        await tx.insert(actionLog).values({
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
      }
      return applied;
    }),
  );
};

/**
 * `awardRecruitRankMilestones` for callers whose own write has already committed (quest and
 * item rewards, staff edits). A failure is reported rather than thrown so it cannot fail the
 * player's request after their promotion landed; nothing is recorded in that case, and the
 * next promotion records every milestone still missing below it.
 */
export const awardRecruitRankMilestonesSafely = async (
  props: Parameters<typeof awardRecruitRankMilestones>[0],
) => {
  try {
    return await awardRecruitRankMilestones(props);
  } catch (error) {
    logError(error, "Failed to record recruit rank milestones", {
      recruitUserId: props.recruitUserId,
      rank: props.rank,
    });
    return [];
  }
};

/** What the recruiter is told about a recruit's eligibility; never which account or IP. */
export type RecruitEligibilityDisplay = "ELIGIBLE" | "SHARED_IP" | "UNVERIFIED";

/**
 * Reduce a referral's internal eligibility reason to what the recruitment page shows. A recruit
 * without a referral record was never checked and is treated like an unverified one.
 */
export const toRecruitEligibilityDisplay = (
  referral: Pick<RecruitReferralRow, "isEligible" | "eligibilityReason"> | undefined,
): RecruitEligibilityDisplay => {
  if (referral?.isEligible) return "ELIGIBLE";
  if (
    referral?.eligibilityReason === "SHARED_IP" ||
    referral?.eligibilityReason === "BACKFILL_SHARED_IP"
  ) {
    return "SHARED_IP";
  }
  return "UNVERIFIED";
};

/**
 * Eligibility and milestone ledger for every recruit of `recruiterId`, shaped for the
 * recruitment page. Milestones list every rank on the ladder, marking the ones reached.
 */
export const fetchRecruitMilestoneSummary = async (
  client: DrizzleClient,
  recruiterId: string,
) => {
  const [referrals, milestones] = await Promise.all([
    client
      .select({
        recruitUserId: recruitReferral.recruitUserId,
        isEligible: recruitReferral.isEligible,
        eligibilityReason: recruitReferral.eligibilityReason,
      })
      .from(recruitReferral)
      .where(eq(recruitReferral.recruiterId, recruiterId)),
    client
      .select({
        recruitUserId: recruitRankMilestone.recruitUserId,
        rank: recruitRankMilestone.rank,
        status: recruitRankMilestone.status,
        reputationAwarded: recruitRankMilestone.reputationAwarded,
      })
      .from(recruitRankMilestone)
      .where(eq(recruitRankMilestone.recruiterId, recruiterId)),
  ]);
  const referralByRecruit = new Map(referrals.map((r) => [r.recruitUserId, r]));
  const milestonesByRecruit = new Map<string, typeof milestones>();
  for (const milestone of milestones) {
    const list = milestonesByRecruit.get(milestone.recruitUserId) ?? [];
    list.push(milestone);
    milestonesByRecruit.set(milestone.recruitUserId, list);
  }
  const recruitIds = new Set([
    ...referralByRecruit.keys(),
    ...milestonesByRecruit.keys(),
  ]);
  return [...recruitIds].map((recruitUserId) => {
    const recorded = milestonesByRecruit.get(recruitUserId) ?? [];
    return {
      recruitUserId,
      eligibility: toRecruitEligibilityDisplay(referralByRecruit.get(recruitUserId)),
      milestones: RECRUIT_RANK_MILESTONES.map((m) => {
        const row = recorded.find((r) => r.rank === m.rank);
        return {
          rank: m.rank,
          reputation: m.reputation,
          reached: !!row,
          paid: row?.status === "PAID",
          reputationAwarded: row?.reputationAwarded ?? 0,
        };
      }),
    };
  });
};
