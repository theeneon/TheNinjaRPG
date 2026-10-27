/**
 * Database access for elder; authorization and transaction scopes stay in callers.
 */
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  clan,
  notification,
  userData,
  village,
  villageElderVote,
  villageElderVoteEntry,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Build the `villageElderVote` listing for `fetchElderVotes`, using predicates on `villageId` and `status`. */
export const listVillageElderVoteForFetchElderVotes = (
  client: Pick<DrizzleClient, "query">,
  villageId: string,
) =>
  client.query.villageElderVote.findMany({
    where: and(
      eq(villageElderVote.villageId, villageId),
      eq(villageElderVote.status, "PENDING"),
    ),
    with: {
      entries: {
        with: {
          user: { columns: { username: true, userId: true, avatar: true } },
        },
      },
      initiatedBy: { columns: { username: true, userId: true, avatar: true } },
    },
    orderBy: [desc(villageElderVote.createdAt)],
  });

/** Build the `village` selection for `fetchElderVotes`, using predicates on `id`. */
export const selectVillageForFetchElderVotes = (
  client: Pick<DrizzleClient, "select">,
  villageTargetIds: string[],
) =>
  client
    .select({ id: village.id, name: village.name })
    .from(village)
    .where(inArray(village.id, villageTargetIds));

/** Build the `userData` selection for `fetchElderVotes`, using predicates on `userId`. */
export const selectUserDataForFetchElderVotes = (
  client: Pick<DrizzleClient, "select">,
  userTargetIds: string[],
) =>
  client
    .select({ userId: userData.userId, username: userData.username })
    .from(userData)
    .where(inArray(userData.userId, userTargetIds));

/**
 * Fetch a single elder vote by ID
 */
export const fetchElderVote = async (client: DrizzleClient, voteId: string) => {
  return client.query.villageElderVote.findFirst({
    where: eq(villageElderVote.id, voteId),
    with: { entries: true },
  });
};

/** Build the `villageElderVoteEntry` insert for `castElderVoteEntry`, updating duplicate keys. */
export const insertVillageElderVoteEntryForCastElderVoteEntry = (
  client: Pick<DrizzleClient, "insert">,
  voteId: string,
  userId: string,
  vote: "YES" | "NO",
) =>
  client
    .insert(villageElderVoteEntry)
    .values({ id: nanoid(), voteId, userId, vote })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/**
 * Fetch all pending elder votes whose deadline has passed
 */
export const fetchExpiredElderVotes = async (client: DrizzleClient) => {
  return client.query.villageElderVote.findMany({
    where: and(
      eq(villageElderVote.status, "PENDING"),
      lt(villageElderVote.endsAt, new Date()),
    ),
    with: { entries: true },
  });
};

/** Build the `userData` selection for `processExpiredElderVotes`, using predicates on `rank` and `isAi`. */
export const selectUserDataForProcessExpiredElderVotes = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({ userId: userData.userId, villageId: userData.villageId })
    .from(userData)
    .where(and(eq(userData.rank, "ELDER"), eq(userData.isAi, false)));

/** Build the `village` listing for `processExpiredElderVotes`. */
export const listVillageForProcessExpiredElderVotes = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.village.findMany({
    columns: { id: true, name: true, kageId: true, tokens: true },
  });

/** Build the `villageElderVote` update for `rejectWithNotification`, setting `status`, using predicates on `id`. */
export const updateVillageElderVoteForRejectWithNotification = (
  client: Pick<DrizzleClient, "update">,
  vote: { id: string },
) =>
  client
    .update(villageElderVote)
    .set({ status: "REJECTED" })
    .where(eq(villageElderVote.id, vote.id));

/** Build the `notification` insert for `rejectWithNotification`. */
export const insertNotificationForRejectWithNotification = (
  client: Pick<DrizzleClient, "insert">,
  vote: { initiatedByUserId: string },
  content: string,
) => client.insert(notification).values({ userId: vote.initiatedByUserId, content });

/** Build the `village` listing for `handleCutoff`, selecting only `id` and `name`, using predicates on `type`. */
export const listVillageForHandleCutoff = (client: Pick<DrizzleClient, "query">) =>
  client.query.village.findMany({
    where: eq(village.type, "VILLAGE"),
    columns: { id: true, name: true },
  });

/** Build the `clan` listing for `handleCutoff`, using predicates on `villageId`. */
export const listClanForHandleCutoff = (client: Pick<DrizzleClient, "query">) =>
  client.query.clan.findMany({
    where: isNotNull(clan.villageId),
    columns: {
      id: true,
      villageId: true,
      activityPoints: true,
      points: true,
    },
  });

/** Build the `clan` update for `handleCutoff`, using predicates on `villageId`. */
export const updateClanForHandleCutoff = (
  client: Pick<DrizzleClient, "update">,
  villageIds: string[],
) =>
  client
    .update(clan)
    .set({
      elderCutoffMonth: null,
      elderCutoffYear: null,
      elderCutoffRank: null,
    })
    .where(inArray(clan.villageId, villageIds));

/** Build the `clan` update for `handleCutoff`, using predicates on `id`. */
export const updateClanForHandleCutoff2 = (
  client: Pick<DrizzleClient, "update">,
  currentMonth: number,
  currentYear: number,
  c: { rank: number; id: string },
) =>
  client
    .update(clan)
    .set({
      elderCutoffMonth: currentMonth,
      elderCutoffYear: currentYear,
      elderCutoffRank: c.rank,
    })
    .where(eq(clan.id, c.id));

/** Build the `clan` listing for `handleRotation`, using predicates on `elderCutoffRank`. */
export const listClanForHandleRotation = (client: Pick<DrizzleClient, "query">) =>
  client.query.clan.findMany({
    where: isNotNull(clan.elderCutoffRank),
    columns: {
      id: true,
      villageId: true,
      leaderId: true,
      elderNomineeId: true,
      elderCutoffRank: true,
      activityPoints: true,
      points: true,
    },
  });

/** Build the `clan` listing for `handleRotation`, using predicates on `villageId`. */
export const listClanForHandleRotation2 = (client: Pick<DrizzleClient, "query">) =>
  client.query.clan.findMany({
    where: isNotNull(clan.villageId),
    columns: {
      id: true,
      villageId: true,
      leaderId: true,
      elderNomineeId: true,
      elderCutoffRank: true,
      activityPoints: true,
      points: true,
    },
  });

/** Build the `userData` update for `handleRotation`, setting `rank`, using predicates on `villageId` and `rank`. */
export const updateUserDataForHandleRotation = (
  client: Pick<DrizzleClient, "update">,
  villageIds: string[],
) =>
  client
    .update(userData)
    .set({ rank: "JONIN" })
    .where(and(inArray(userData.villageId, villageIds), eq(userData.rank, "ELDER")));

/** Build the `userData` listing for `handleRotation`, including predicates on `userId`, `villageId`, `isBanned`. */
export const listUserDataForHandleRotation = (
  client: Pick<DrizzleClient, "query">,
  allNomineeIds: Set<string>,
  villageIds: string[],
) =>
  client.query.userData.findMany({
    where: and(
      inArray(userData.userId, [...allNomineeIds]),
      inArray(userData.villageId, villageIds),
      eq(userData.isBanned, false),
      eq(userData.rank, "JONIN"),
      isNull(userData.anbuId),
    ),
    columns: { userId: true, clanId: true, villageId: true },
  });

/** Build the `userData` update for `handleRotation`, setting `rank`, using predicates on `userId`. */
export const updateUserDataForHandleRotation2 = (
  client: Pick<DrizzleClient, "update">,
  toPromote: string[],
) =>
  client
    .update(userData)
    .set({ rank: "ELDER" })
    .where(inArray(userData.userId, toPromote));

/** Build the `clan` update for `handleRotation`, using predicates on `villageId`. */
export const updateClanForHandleRotation = (
  client: Pick<DrizzleClient, "update">,
  villageIds: string[],
) =>
  client
    .update(clan)
    .set({
      activityPoints: 0,
      elderNomineeId: null,
      elderCutoffMonth: null,
      elderCutoffYear: null,
      elderCutoffRank: null,
    })
    .where(inArray(clan.villageId, villageIds));
