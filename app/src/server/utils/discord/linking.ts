import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DiscordTokenSource, DiscordUnlinkReason } from "@/drizzle/constants";
import { discordLink, userData } from "@/drizzle/schema";
import {
  type DiscordLinkResult,
  type DiscordLinkResultDetails,
  discordSnowflakeCreatedAt,
} from "@/libs/discordLink";
import type { DrizzleClient } from "@/server/db";
import { fetchClerkDiscordToken } from "@/server/utils/discord/clerk";
import type { DiscordConfig } from "@/server/utils/discord/config";
import {
  archiveDiscordLink,
  clerkDiscordIdOf,
  findClerkDiscordFlags,
  insertDiscordLink,
  loadLinkCandidate,
  logDiscordAction,
} from "@/server/utils/discord/links";
import {
  DISCORD_OAUTH_SCOPES,
  type DiscordTokenSet,
  type DiscordUser,
  discordHandle,
  exchangeCode,
  fetchAuthorization,
  fetchCurrentUser,
  hasRequiredScopes,
  revokeToken,
} from "@/server/utils/discord/rest";
import { evaluateDiscordLink } from "@/server/utils/discord/rules";
import { encryptToken } from "@/server/utils/discord/secrets";
import { releaseDiscordMember, syncDiscordMember } from "@/server/utils/discord/sync";
import type { SanctionIdentity } from "@/server/utils/sanctionTombstone";

export type DiscordLinkOutcome = {
  result: DiscordLinkResult;
} & DiscordLinkResultDetails;

/**
 * A verified Discord authorization to link with: the player's Discord account, the granted
 * scopes and a working access token. OAUTH grants come from the consent flow and carry the
 * token pair to store; CLERK grants reuse the player's Clerk Discord sign-in and store none.
 */
export type DiscordLinkGrant = {
  source: DiscordTokenSource;
  discordUser: DiscordUser;
  scope: string;
  accessToken: string;
  /** OAUTH only: stored encrypted, and revoked when the link is refused. */
  tokens: DiscordTokenSet | null;
};

/**
 * Exchange the OAuth callback code. Returns null, after revoking the token, when the player
 * removed a required scope on the consent screen.
 */
export const exchangeDiscordCode = async (
  config: DiscordConfig,
  code: string,
): Promise<DiscordLinkGrant | null> => {
  const tokens = await exchangeCode(config, code);
  if (!hasRequiredScopes(tokens.scope.split(" "))) {
    await revokeGrant(config, tokens);
    return null;
  }
  return {
    source: "OAUTH",
    discordUser: await fetchCurrentUser(tokens.access_token),
    scope: tokens.scope,
    accessToken: tokens.access_token,
    tokens,
  };
};

/**
 * A grant from the player's Clerk Discord sign-in, or null when the link needs the consent
 * flow instead: no Discord sign-in, a Clerk token from before `role_connections.write` was
 * requested, or a token issued for another application or Discord account.
 */
export const resolveClerkDiscordGrant = async (
  config: DiscordConfig,
  userId: string,
): Promise<DiscordLinkGrant | null> => {
  const clerkToken = await fetchClerkDiscordToken(userId);
  if (!clerkToken || !hasRequiredScopes(clerkToken.scopes)) return null;
  // Discord's own answer decides: Clerk's scope list and account can lag behind.
  const authorization = await fetchAuthorization(clerkToken.accessToken);
  if (
    authorization.application.id !== config.clientId ||
    !hasRequiredScopes(authorization.scopes) ||
    !authorization.user ||
    authorization.user.id !== clerkToken.discordId
  )
    return null;
  return {
    source: "CLERK",
    discordUser: authorization.user,
    scope: authorization.scopes.join(" "),
    accessToken: clerkToken.accessToken,
    tokens: null,
  };
};

/** Revoke an OAuth grant's tokens; Clerk's sign-in token is never revoked. */
const revokeGrant = (config: DiscordConfig, tokens: DiscordTokenSet | null) =>
  tokens
    ? revokeToken(config, tokens.refresh_token).catch((error: unknown) => {
        console.error("[Discord] Token revoke failed", error);
      })
    : Promise.resolve();

/** Token columns for a grant: the encrypted pair for OAUTH, nothing for CLERK. */
const grantTokenColumns = (config: DiscordConfig, grant: DiscordLinkGrant) => ({
  tokenSource: grant.source,
  accessToken: grant.tokens
    ? encryptToken(grant.tokens.access_token, config.tokenKey)
    : null,
  refreshToken: grant.tokens
    ? encryptToken(grant.tokens.refresh_token, config.tokenKey)
    : null,
  tokenExpiresAt: grant.tokens
    ? new Date(Date.now() + grant.tokens.expires_in * 1000)
    : null,
  scopes: grant.scope,
});

/**
 * Link with a verified grant: apply the linking rules, store the link and push the Discord
 * side. The OAuth callback and the Clerk auto-link share this path, so both enforce the same
 * rules. A refused OAuth grant is revoked right away, so nothing is kept for players who were
 * refused.
 */
export const completeDiscordLink = async (
  client: DrizzleClient,
  config: DiscordConfig,
  input: { userId: string; grant: DiscordLinkGrant; identity: SanctionIdentity | null },
): Promise<DiscordLinkOutcome> => {
  const { grant } = input;
  const discordUser = grant.discordUser;
  const discordCreatedAt = discordSnowflakeCreatedAt(discordUser.id);
  const { candidate, character, existing } = await loadLinkCandidate(client, {
    userId: input.userId,
    discordId: discordUser.id,
    discordCreatedAt,
  });
  const decision = evaluateDiscordLink(candidate);
  if (!decision.allowed) {
    await revokeGrant(config, grant.tokens);
    const { allowed: _allowed, ...outcome } = decision;
    return outcome;
  }
  const tokenColumns = grantTokenColumns(config, grant);
  const handle = discordHandle(discordUser);
  const clerkDiscordId = clerkDiscordIdOf(input.identity);
  if (decision.relink && existing) {
    // Same pair again (e.g. the Linked Roles flow from Discord): keep the link, store the
    // fresh token source and re-apply everything. A replaced OAuth pair is not revoked:
    // Discord may end the whole authorization, which the new token and Clerk's share.
    await client
      .update(discordLink)
      .set({ ...tokenColumns, discordUsername: handle, clerkDiscordId, syncedAt: null })
      .where(eq(discordLink.id, existing.id));
    await syncDiscordMember(client, input.userId, { force: true });
    return { result: "relinked" };
  }
  const inserted = await insertDiscordLink(client, {
    id: nanoid(),
    userId: input.userId,
    discordId: discordUser.id,
    discordUsername: handle,
    discordCreatedAt,
    clerkDiscordId,
    ...tokenColumns,
  });
  if (!inserted) {
    // A concurrent callback linked one side first.
    await revokeGrant(config, grant.tokens);
    return { result: "linked_elsewhere" };
  }
  const flags = await findClerkDiscordFlags(client, {
    userId: input.userId,
    discordId: discordUser.id,
    clerkDiscordId,
  });
  await Promise.all([
    logDiscordAction(client, {
      actorUserId: input.userId,
      targetUserId: input.userId,
      message: `Linked Discord ${handle}`,
      changes: [
        `Discord: ${handle} (${discordUser.id})`,
        `Discord account created: ${discordCreatedAt.toISOString()}`,
        `Scopes: ${grant.scope}`,
        grant.source === "CLERK"
          ? "Linked automatically from the Clerk Discord sign-in"
          : "Linked through the Discord consent screen",
      ],
      image: character?.avatarLight,
    }),
    ...(flags.length
      ? [
          logDiscordAction(client, {
            actorUserId: input.userId,
            targetUserId: input.userId,
            message: `Discord link flag: ${flags[0]}`,
            changes: flags,
            image: character?.avatarLight,
          }),
        ]
      : []),
  ]);
  await syncDiscordMember(client, input.userId, { force: true });
  return { result: "linked" };
};

/** The /discord/link page showing an outcome of the linking flow. */
export const discordLinkResultUrl = (
  requestUrl: string,
  result: string,
  details: DiscordLinkResultDetails = {},
) => {
  const target = new URL("/discord/link", requestUrl);
  target.searchParams.set("result", result);
  if (details.hint) target.searchParams.set("hint", details.hint);
  if (details.until) target.searchParams.set("until", details.until);
  if (details.automatic) target.searchParams.set("auto", "1");
  return target;
};

/** Scopes as shown to staff; guilds.join is optional for a working link. */
export const describeScopes = (scopes: string) =>
  DISCORD_OAUTH_SCOPES.map(
    (scope) => `${scope}: ${scopes.split(" ").includes(scope) ? "yes" : "no"}`,
  );

/**
 * Remove a link and its Discord side, then archive it for the cooldown. Returns false when
 * the character had no link.
 */
export const removeDiscordLink = async (
  client: DrizzleClient,
  input: {
    userId: string;
    reason: DiscordUnlinkReason;
    actorUserId: string;
    staffNote?: string;
    cooldownWaived?: boolean;
  },
) => {
  const [link, character] = await Promise.all([
    client.query.discordLink.findFirst({ where: eq(discordLink.userId, input.userId) }),
    client.query.userData.findFirst({
      columns: { username: true, avatarLight: true },
      where: eq(userData.userId, input.userId),
    }),
  ]);
  if (!link) return false;
  const cleanup = await releaseDiscordMember(client, link, character?.username ?? "");
  const removed = await archiveDiscordLink(client, link, input.reason, {
    staffUserId: input.reason === "STAFF" ? input.actorUserId : undefined,
    cooldownWaived: input.cooldownWaived,
  });
  if (removed && input.reason !== "ACCOUNT_DELETED") {
    await logDiscordAction(client, {
      actorUserId: input.actorUserId,
      targetUserId: input.userId,
      message:
        input.reason === "STAFF"
          ? `Staff unlinked Discord ${link.discordUsername}`
          : `Unlinked Discord ${link.discordUsername}`,
      changes: [
        `Discord: ${link.discordUsername} (${link.discordId})`,
        ...(input.staffNote ? [`Reason: ${input.staffNote}`] : []),
        ...(input.cooldownWaived ? ["Unlink cooldown waived"] : []),
        ...(cleanup.length
          ? [`Discord cleanup incomplete: ${cleanup.join("; ")}`]
          : []),
      ],
      image: character?.avatarLight,
    });
  }
  return removed;
};
