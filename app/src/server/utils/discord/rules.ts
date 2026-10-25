import {
  DISCORD_MAX_CHARACTERS_PER_ACCOUNT,
  DISCORD_UNLINK_COOLDOWN_DAYS,
} from "@/drizzle/constants";
import type { DiscordLink, DiscordLinkHistory } from "@/drizzle/schema";
import {
  type DiscordLinkResult,
  type DiscordLinkResultDetails,
  discordAccountEligibleAt,
  maskName,
} from "@/libs/discordLink";

/** An active link of the Discord account being linked. */
export type DiscordAccountLink = Pick<DiscordLink, "userId" | "slot" | "isPrimary"> & {
  username: string | null;
};

/** Everything the linking rules read, loaded upfront by the callback. */
export type DiscordLinkCandidate = {
  userId: string;
  discordId: string;
  discordCreatedAt: Date;
  /** The character, or null when the account has none. */
  character: { isBanned: boolean } | null;
  /** True while a ban, or a ban or silence long enough to count as indefinite, runs. */
  hasBlockingSanction: boolean;
  /** True when a deleted, sanctioned account's tombstone holds this Discord id. */
  matchesSanctionTombstone: boolean;
  /** True while the Discord account is banned through another linked character. */
  discordBanned: boolean;
  linkForUser: Pick<DiscordLink, "discordId"> | null;
  /** Active links of this Discord account, including one of this character. */
  linksForDiscord: DiscordAccountLink[];
  /** Ended links of this character and of this Discord account, any order. */
  history: Pick<
    DiscordLinkHistory,
    "userId" | "discordId" | "unlinkedAt" | "cooldownWaived"
  >[];
};

export type DiscordLinkDecision =
  | { allowed: true; relink: true }
  | {
      allowed: true;
      relink: false;
      /** Free slot of the Discord account the new link takes. */
      slot: number;
      /** The first link of a Discord account is its primary. */
      isPrimary: boolean;
      /** The other character already linked to this Discord account, if any. */
      sibling: DiscordAccountLink | null;
    }
  | ({ allowed: false; result: DiscordLinkResult } & DiscordLinkResultDetails);

const COOLDOWN_MS = DISCORD_UNLINK_COOLDOWN_DAYS * 86_400_000;

/**
 * Decide whether a character may link a Discord account. One link per character and at most
 * DISCORD_MAX_CHARACTERS_PER_ACCOUNT per Discord account are enforced by unique keys as well;
 * these checks turn the common cases into explanations and add the age, cooldown and
 * sanction rules.
 *
 * Cooldown: a character that unlinked a Discord account cannot link a *different* one for
 * DISCORD_UNLINK_COOLDOWN_DAYS. A Discord account counts every character it was linked to
 * during that window (active links plus unlinks without a staff waiver) and may not reach
 * more than DISCORD_MAX_CHARACTERS_PER_ACCOUNT distinct characters, so it cannot rotate
 * characters through its slots.
 */
export const evaluateDiscordLink = (
  candidate: DiscordLinkCandidate,
  now = new Date(),
): DiscordLinkDecision => {
  if (!candidate.character) return { allowed: false, result: "no_character" };
  if (candidate.character.isBanned || candidate.hasBlockingSanction)
    return { allowed: false, result: "banned" };
  if (candidate.matchesSanctionTombstone) return { allowed: false, result: "blocked" };
  const others = candidate.linksForDiscord.filter(
    (link) => link.userId !== candidate.userId,
  );
  const sameLink =
    candidate.linkForUser?.discordId === candidate.discordId &&
    others.length < candidate.linksForDiscord.length;
  if (sameLink) return { allowed: true, relink: true };
  if (candidate.discordBanned) return { allowed: false, result: "blocked" };
  if (others.length >= DISCORD_MAX_CHARACTERS_PER_ACCOUNT)
    return {
      allowed: false,
      result: "discord_full",
      hint:
        others
          .flatMap((link) => (link.username ? [maskName(link.username)] : []))
          .join(", ") || undefined,
    };
  if (candidate.linkForUser) return { allowed: false, result: "character_has_link" };
  const eligibleAt = discordAccountEligibleAt(candidate.discordCreatedAt);
  if (eligibleAt > now)
    return { allowed: false, result: "too_new", until: eligibleAt.toISOString() };
  const cooldownEnd = discordCooldownEnd(candidate, others, now);
  if (cooldownEnd)
    return { allowed: false, result: "cooldown", until: cooldownEnd.toISOString() };
  const used = new Set(others.map((link) => link.slot));
  const slot =
    Array.from({ length: DISCORD_MAX_CHARACTERS_PER_ACCOUNT }, (_, i) => i + 1).find(
      (value) => !used.has(value),
    ) ?? DISCORD_MAX_CHARACTERS_PER_ACCOUNT;
  const sibling = others.find((link) => link.isPrimary) ?? others[0] ?? null;
  return { allowed: true, relink: false, slot, isPrimary: !sibling, sibling };
};

/**
 * When the cooldown stops blocking this link, or null when it does not block it. Relinking a
 * partner from the window is always allowed: it adds no new character or Discord account.
 */
const discordCooldownEnd = (
  candidate: DiscordLinkCandidate,
  others: DiscordAccountLink[],
  now: Date,
) => {
  const running = candidate.history.filter(
    (entry) =>
      !entry.cooldownWaived && entry.unlinkedAt.getTime() + COOLDOWN_MS > now.getTime(),
  );
  const ends: number[] = [];
  // The character switching to a different Discord account.
  for (const entry of running)
    if (entry.userId === candidate.userId && entry.discordId !== candidate.discordId)
      ends.push(entry.unlinkedAt.getTime() + COOLDOWN_MS);
  // The Discord account reaching too many distinct characters within the window.
  const counted = new Set([candidate.userId, ...others.map((link) => link.userId)]);
  const recentEnds = new Map<string, number>();
  for (const entry of running) {
    if (entry.discordId !== candidate.discordId || counted.has(entry.userId)) continue;
    const end = entry.unlinkedAt.getTime() + COOLDOWN_MS;
    recentEnds.set(entry.userId, Math.max(end, recentEnds.get(entry.userId) ?? 0));
  }
  const excess = counted.size + recentEnds.size - DISCORD_MAX_CHARACTERS_PER_ACCOUNT;
  if (excess > 0) {
    // The window frees up once enough of those unlinked characters have dropped out of it.
    const end = [...recentEnds.values()].sort((a, b) => a - b)[excess - 1];
    if (end !== undefined) ends.push(end);
  }
  return ends.length ? new Date(Math.max(...ends)) : null;
};
