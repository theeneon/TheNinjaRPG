import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  ne,
  or,
  SQL,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  DISCORD_INDEFINITE_SANCTION_DAYS,
  DISCORD_UNLINK_COOLDOWN_DAYS,
  type DiscordUnlinkReason,
} from "@/drizzle/constants";
import {
  actionLog,
  type DiscordLink,
  discordLink,
  discordLinkHistory,
  userData,
  userReport,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { isClerkDiscordProvider } from "@/server/utils/discord/clerk";
import type { DiscordLinkCandidate } from "@/server/utils/discord/rules";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import {
  fetchActiveSanctionTombstones,
  hashSanctionIdentifier,
  type SanctionIdentity,
} from "@/server/utils/sanctionTombstone";

/**
 * Tombstones hash linked OAuth identities as `<provider>:<provider user id>`; a linked
 * Discord account uses the same form as a Discord login, so either one blocks re-linking.
 */
export const discordTombstoneHash = (discordId: string) =>
  hashSanctionIdentifier("oauth", `discord:${discordId}`);

/** The Discord id a character signs in with through Clerk, if any. */
export const clerkDiscordIdOf = (identity: SanctionIdentity | null) =>
  identity?.externalAccounts.find((account) => isClerkDiscordProvider(account.provider))
    ?.providerUserId ?? null;

/**
 * Bans and silences that ban the linked Discord account: still running, and imposed for at
 * least DISCORD_INDEFINITE_SANCTION_DAYS. The length is measured from the decision
 * (`updatedAt`, written with status and `banEnd` by `updateSanctionReport`), so a long ban
 * keeps matching until it ends instead of dropping out once less than the window remains.
 * `userId` is a value, a joined column or a subquery of user ids.
 */
export const indefiniteSanctionWhere = (userId: string | AnyColumn | SQL) =>
  and(
    userId instanceof SQL
      ? inArray(userReport.reportedUserId, userId)
      : eq(userReport.reportedUserId, userId),
    inArray(userReport.status, ["BAN_ACTIVATED", "SILENCE_ACTIVATED"]),
    gt(userReport.banEnd, sql`CURRENT_TIMESTAMP(3)`),
    gte(
      userReport.banEnd,
      sql`${userReport.updatedAt} + INTERVAL ${sql.raw(String(DISCORD_INDEFINITE_SANCTION_DAYS))} DAY`,
    ),
  );

/** The report behind an indefinite ban or silence, preferring bans. */
export const fetchIndefiniteSanction = async (
  client: DrizzleClient,
  userId: string,
) => {
  const reports = await client
    .select({ id: userReport.id, status: userReport.status })
    .from(userReport)
    .where(indefiniteSanctionWhere(userId));
  return (
    reports.find((report) => report.status === "BAN_ACTIVATED") ?? reports[0] ?? null
  );
};

/** User ids linked to a Discord account, as a subquery. */
export const discordAccountUserIds = (discordId: string) =>
  sql`(SELECT ${discordLink.userId} FROM ${discordLink} WHERE ${discordLink.discordId} = ${discordId})`;

/**
 * Indefinite sanctions of any character linked to a Discord account: the account stays banned
 * while one of them runs.
 */
export const fetchDiscordAccountSanctions = (
  client: DrizzleClient,
  discordId: string,
) =>
  client
    .select({
      id: userReport.id,
      status: userReport.status,
      userId: userReport.reportedUserId,
    })
    .from(userReport)
    .where(indefiniteSanctionWhere(discordAccountUserIds(discordId)));

/**
 * The links of a Discord account, primary first. Without exactly one `isPrimary` row (a race
 * between an unlink and a link can leave none for a moment), the lowest slot counts as
 * primary until the next sync writes it back.
 */
export const fetchDiscordAccountLinks = (client: DrizzleClient, discordId: string) =>
  client.query.discordLink.findMany({
    where: eq(discordLink.discordId, discordId),
    with: { user: { columns: { username: true, level: true, villageId: true } } },
    orderBy: [desc(discordLink.isPrimary), asc(discordLink.slot)],
  });

/**
 * Make one link the primary of its Discord account and every other link of it secondary, in
 * a single statement.
 */
export const setDiscordPrimary = (
  client: DrizzleClient,
  link: Pick<DiscordLink, "id" | "discordId">,
) =>
  client
    .update(discordLink)
    .set({ isPrimary: sql`(${discordLink.id} = ${link.id})` })
    .where(eq(discordLink.discordId, link.discordId));

/** Load everything the linking rules need in one round of parallel reads. */
export const loadLinkCandidate = async (
  client: DrizzleClient,
  input: { userId: string; discordId: string; discordCreatedAt: Date },
) => {
  const cooldownStart = new Date(
    Date.now() - DISCORD_UNLINK_COOLDOWN_DAYS * 86_400_000,
  );
  const [
    character,
    linkForUser,
    linksForDiscord,
    history,
    sanctions,
    tombstones,
    discordSanctions,
  ] = await Promise.all([
    client.query.userData.findFirst({
      columns: {
        userId: true,
        username: true,
        level: true,
        villageId: true,
        isBanned: true,
        avatarLight: true,
      },
      where: eq(userData.userId, input.userId),
    }),
    client.query.discordLink.findFirst({
      where: eq(discordLink.userId, input.userId),
    }),
    client.query.discordLink.findMany({
      columns: { userId: true, slot: true, isPrimary: true, syncedBanned: true },
      where: eq(discordLink.discordId, input.discordId),
      with: { user: { columns: { username: true } } },
    }),
    client.query.discordLinkHistory.findMany({
      columns: {
        userId: true,
        discordId: true,
        unlinkedAt: true,
        cooldownWaived: true,
      },
      where: and(
        or(
          eq(discordLinkHistory.userId, input.userId),
          eq(discordLinkHistory.discordId, input.discordId),
        ),
        gt(discordLinkHistory.unlinkedAt, cooldownStart),
      ),
    }),
    client
      .select({ id: userReport.id })
      .from(userReport)
      .where(
        or(
          and(
            eq(userReport.reportedUserId, input.userId),
            eq(userReport.status, "BAN_ACTIVATED"),
            gt(userReport.banEnd, sql`CURRENT_TIMESTAMP(3)`),
          ),
          indefiniteSanctionWhere(input.userId),
        ),
      )
      .limit(1),
    fetchActiveSanctionTombstones(client),
    fetchDiscordAccountSanctions(client, input.discordId),
  ]);
  const hash = discordTombstoneHash(input.discordId);
  const candidate: DiscordLinkCandidate = {
    userId: input.userId,
    discordId: input.discordId,
    discordCreatedAt: input.discordCreatedAt,
    character: character ? { isBanned: character.isBanned } : null,
    hasBlockingSanction: sanctions.length > 0,
    matchesSanctionTombstone: tombstones.some((tombstone) =>
      tombstone.accountHashes.includes(hash),
    ),
    discordBanned:
      discordSanctions.length > 0 || linksForDiscord.some((link) => link.syncedBanned),
    linkForUser: linkForUser ? { discordId: linkForUser.discordId } : null,
    linksForDiscord: linksForDiscord.map((link) => ({
      userId: link.userId,
      slot: link.slot,
      isPrimary: link.isPrimary,
      username: link.user?.username ?? null,
    })),
    history,
  };
  return { candidate, character, existing: linkForUser ?? null };
};

/**
 * Insert a link. The unique keys on userId and (discordId, slot) settle a race between two
 * callbacks for the same character or the same free slot of a Discord account: the loser gets
 * false, so a Discord account never exceeds its slots.
 */
export const insertDiscordLink = async (
  client: DrizzleClient,
  values: typeof discordLink.$inferInsert,
) => {
  try {
    await client.insert(discordLink).values(values);
    return true;
  } catch (error) {
    if (isMysqlDuplicateKeyError(error)) return false;
    throw error;
  }
};

/**
 * End a link: archive it, then delete it. History is keyed by the link id, so a retry after
 * a failed delete archives nothing twice. Two ordered writes keep this restartable without a
 * transaction; the worst partial outcome is a history row whose link still exists, which the
 * cooldown check ignores for the same pair.
 */
export const archiveDiscordLink = async (
  client: DrizzleClient,
  link: Pick<
    DiscordLink,
    "id" | "userId" | "discordId" | "discordUsername" | "linkedAt"
  >,
  reason: DiscordUnlinkReason,
  options: { staffUserId?: string; cooldownWaived?: boolean } = {},
) => {
  await client
    .insert(discordLinkHistory)
    .values({
      id: link.id,
      userId: link.userId,
      discordId: link.discordId,
      discordUsername: link.discordUsername,
      linkedAt: link.linkedAt,
      reason,
      unlinkedByUserId: options.staffUserId ?? null,
      cooldownWaived: options.cooldownWaived ?? false,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`${discordLinkHistory.id}` } });
  const result = await client.delete(discordLink).where(eq(discordLink.id, link.id));
  return result.rowsAffected > 0;
};

/**
 * Staff-visible abuse signals around Clerk Discord logins; they never block linking. Other
 * characters linked to the same Discord account are a declared second account, not a flag.
 */
export const findClerkDiscordFlags = async (
  client: DrizzleClient,
  input: { userId: string; discordId: string; clerkDiscordId: string | null },
) => {
  const flags: string[] = [];
  if (input.clerkDiscordId && input.clerkDiscordId !== input.discordId)
    flags.push(
      `Linked Discord ${input.discordId} differs from the Discord login ${input.clerkDiscordId} of this account`,
    );
  const related = await client.query.discordLink.findMany({
    columns: { userId: true, discordId: true, clerkDiscordId: true },
    with: { user: { columns: { username: true } } },
    where: and(
      ne(discordLink.userId, input.userId),
      ne(discordLink.discordId, input.discordId),
      or(
        eq(discordLink.clerkDiscordId, input.discordId),
        input.clerkDiscordId
          ? eq(discordLink.discordId, input.clerkDiscordId)
          : undefined,
      ),
    ),
  });
  for (const link of related) {
    const name = link.user?.username ?? link.userId;
    if (link.clerkDiscordId === input.discordId)
      flags.push(
        `Discord ${input.discordId} is the Discord login of another character: ${name}`,
      );
    if (input.clerkDiscordId && link.discordId === input.clerkDiscordId)
      flags.push(
        `This account's Discord login ${input.clerkDiscordId} is linked to another character: ${name}`,
      );
  }
  return flags;
};

/** ActionLog entry for link changes; staff read them on the Discord links page. */
export const logDiscordAction = (
  client: DrizzleClient,
  entry: {
    actorUserId: string;
    targetUserId: string;
    message: string;
    changes: string[];
    image?: string | null;
  },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: entry.actorUserId,
    tableName: "discordLink",
    relatedId: entry.targetUserId,
    relatedMsg: entry.message.slice(0, 191),
    relatedImage: entry.image ?? null,
    changes: entry.changes,
  });

/** Discord link ActionLog entries about a character, newest first. */
export const fetchDiscordActionLog = (client: DrizzleClient, userId: string) =>
  client.query.actionLog.findMany({
    columns: {
      id: true,
      createdAt: true,
      relatedMsg: true,
      changes: true,
      userId: true,
    },
    where: and(eq(actionLog.tableName, "discordLink"), eq(actionLog.relatedId, userId)),
    orderBy: desc(actionLog.createdAt),
    limit: 50,
  });
