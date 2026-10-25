import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { DISCORD_INDEFINITE_SANCTION_DAYS } from "@/drizzle/constants";
import {
  actionLog,
  discordLink,
  discordLinkHistory,
  sanctionTombstone,
  userData,
  userReport,
} from "@/drizzle/schema";
import { GET as authorizeDiscord } from "@/app/api/discord/authorize/route";
import { DISCORD_RELINK_REQUIRED, needsDiscordRelink } from "@/libs/discordLink";
import { discordRouter } from "@/server/api/routers/discord";
import { deleteUser } from "@/server/api/routers/staff";
import { getDiscordConfig } from "@/server/utils/discord/config";
import {
  archiveDiscordLink,
  discordTombstoneHash,
  insertDiscordLink,
  loadLinkCandidate,
} from "@/server/utils/discord/links";
import {
  completeDiscordLink,
  exchangeDiscordCode,
  resolveClerkDiscordGrant,
} from "@/server/utils/discord/linking";
import { encryptToken } from "@/server/utils/discord/secrets";
import {
  fetchLinksNeedingSync,
  reconcileDiscordLinks,
  syncDiscordMember,
} from "@/server/utils/discord/sync";
import { recordSanctionTombstone } from "@/server/utils/sanctionTombstone";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  indexColumns,
  resetTables,
} from "../../../setup/testDatabase";

const DAY = 86_400_000;
const GUILD = "2222222222222222222";
const VILLAGE_ROLE = "5555555555555555555";
const VERIFIED_ROLE = "6666666666666666666";
/** Created 2016, well past the minimum account age. */
const OLD_DISCORD = "175928847299117063";
const OTHER_DISCORD = "175928847299117064";
const KEY = Buffer.alloc(32, 9);

const ENV = {
  DISCORD_LINKING_ENABLED: "true",
  DISCORD_CLIENT_ID: "1111111111111111111",
  DISCORD_CLIENT_SECRET: "client-secret",
  DISCORD_BOT_TOKEN: "bot-token",
  DISCORD_GUILD_ID: GUILD,
  DISCORD_VERIFIED_ROLE_ID: VERIFIED_ROLE,
  DISCORD_VILLAGE_ROLE_IDS: JSON.stringify({ "village-a": VILLAGE_ROLE }),
  DISCORD_TOKEN_ENCRYPTION_KEY: KEY.toString("base64"),
  NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
};
const originalEnv = Object.fromEntries(
  Object.keys(ENV).map((key) => [key, process.env[key]]),
);
const originalFetch = globalThis.fetch;

type Call = {
  method: string;
  path: string;
  body: unknown;
  reason: string | null;
  auth: string | null;
};
let calls: Call[] = [];
let guildMember: { nick: string | null; roles: string[] } | null = null;
/** What Discord reports for a bearer token at /oauth2/@me. */
let authorization = {
  application: { id: "1111111111111111111" },
  scopes: ["identify", "role_connections.write", "guilds.join"],
  expires: "2030-01-01T00:00:00.000Z",
  user: { id: OLD_DISCORD, username: "naruto_fan" },
};

/** A small fake of the Discord endpoints the feature calls. */
const fakeDiscord = (user = { id: OLD_DISCORD, username: "naruto_fan" }) => {
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/api/v10", "");
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body =
      typeof init?.body === "string" && headers["Content-Type"] === "application/json"
        ? JSON.parse(init.body)
        : init?.body
          ? Object.fromEntries(new URLSearchParams(String(init.body)))
          : null;
    calls.push({
      method,
      path,
      body,
      reason: headers["X-Audit-Log-Reason"]
        ? decodeURIComponent(headers["X-Audit-Log-Reason"])
        : null,
      auth: headers.Authorization ?? null,
    });
    const ok = (data: unknown, status = 200) =>
      new Response(data === null ? null : JSON.stringify(data), { status });
    if (path === "/oauth2/token")
      return ok({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 604800,
        scope: "identify role_connections.write guilds.join",
        token_type: "Bearer",
      });
    if (path === "/oauth2/token/revoke") return ok({});
    if (path === "/oauth2/@me") return ok(authorization);
    if (path === "/users/@me") return ok(user);
    if (path.endsWith("/role-connection")) return ok({});
    if (path.startsWith(`/guilds/${GUILD}/members/`) && method === "GET")
      return guildMember
        ? ok(guildMember)
        : ok({ code: 10007, message: "Unknown Member" }, 404);
    if (path.startsWith(`/guilds/${GUILD}/members/`) && method === "PUT" && !path.includes("/roles/"))
      return ok({ roles: [] }, 201);
    return ok(null, 204);
  }) as unknown as typeof fetch;
};

const linkValues = (userId: string, discordId: string) => ({
  id: `link-${userId}`,
  userId,
  discordId,
  discordUsername: `discord-${userId}`,
  discordCreatedAt: new Date("2016-04-30T11:18:25.796Z"),
  accessToken: encryptToken("access-0", KEY),
  refreshToken: encryptToken("refresh-0", KEY),
  tokenExpiresAt: new Date(Date.now() + 7 * DAY),
  scopes: "identify role_connections.write guilds.join",
});

/** The OAuth callback: exchange the code, then link. */
const linkThroughOAuth = async (
  userId: string,
  identity: Parameters<typeof completeDiscordLink>[2]["identity"],
) => {
  const config = getDiscordConfig();
  if (!config) throw new Error("config");
  const grant = await exchangeDiscordCode(config, "code-1");
  if (!grant) throw new Error("grant");
  return completeDiscordLink(await getTestDatabase(), config, { userId, grant, identity });
};

type ClerkToken = { token: string; scopes: string[]; externalAccountId: string };

/** Fake Clerk Backend API holding a Discord sign-in for every user. */
const fakeClerk = (
  options: { discordId?: string | null; tokens?: ClerkToken[] } = {},
) => {
  const discordId = options.discordId === undefined ? OLD_DISCORD : options.discordId;
  const tokens = options.tokens ?? [
    {
      token: "clerk-access",
      scopes: ["identify", "email", "role_connections.write", "guilds.join"],
      externalAccountId: "eac_discord",
    },
  ];
  const getUserOauthAccessToken = vi.fn(async () => ({
    data: discordId ? tokens : [],
    totalCount: tokens.length,
  }));
  vi.spyOn(clerk, "clerkClient").mockResolvedValue({
    users: {
      getUser: vi.fn(async () => ({
        primaryEmailAddressId: null,
        emailAddresses: [],
        externalAccounts: discordId
          ? [{ id: "eac_discord", provider: "oauth_discord", providerUserId: discordId }]
          : [],
      })),
      getUserOauthAccessToken,
    },
  } as unknown as Awaited<ReturnType<typeof clerk.clerkClient>>);
  return { getUserOauthAccessToken };
};

const clerkIdentity = (discordId = OLD_DISCORD) => ({
  primaryEmailAddressId: null,
  emailAddresses: [],
  externalAccounts: [{ provider: "oauth_discord", providerUserId: discordId }],
});

const addSanction = async (
  userId: string,
  status: "BAN_ACTIVATED" | "SILENCE_ACTIVATED",
  days: number,
  id = `report-${userId}`,
  decidedDaysAgo = 0,
) =>
  (await getTestDatabase()).insert(userReport).values({
    id,
    reporterUserId: "staff",
    reportedUserId: userId,
    system: "tavern_comment",
    infraction: {},
    reason: "Spam",
    aiInterpretation: "",
    status,
    banEnd: new Date(Date.now() + days * DAY),
    updatedAt: new Date(Date.now() - decidedDaysAgo * DAY),
  });

describeWithDatabase("Discord links (SQL)", () => {
  beforeEach(async () => {
    Object.assign(process.env, ENV);
    calls = [];
    guildMember = null;
    authorization = {
      ...authorization,
      application: { id: ENV.DISCORD_CLIENT_ID },
      scopes: ["identify", "role_connections.write", "guilds.join"],
      user: { id: OLD_DISCORD, username: "naruto_fan" },
    };
    fakeDiscord();
    await resetTables(
      userData,
      discordLink,
      discordLinkHistory,
      userReport,
      sanctionTombstone,
      actionLog,
    );
    await insertUsers([
      { userId: "user-a", username: "Alpha", level: 20, villageId: "village-a" },
      { userId: "user-b", username: "Bravo", level: 30 },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("keeps one active link per character and per Discord account", async () => {
    const database = await getTestDatabase();
    expect(await indexColumns("DiscordLink", "DiscordLink_userId_key")).toEqual({
      columns: ["userId"],
      unique: true,
    });
    expect(await indexColumns("DiscordLink", "DiscordLink_discordId_key")).toEqual({
      columns: ["discordId"],
      unique: true,
    });
    expect(await insertDiscordLink(database, linkValues("user-a", OLD_DISCORD))).toBe(true);
    expect(
      await insertDiscordLink(database, {
        ...linkValues("user-a", OTHER_DISCORD),
        id: "second-link-for-user",
      }),
    ).toBe(false);
    expect(await insertDiscordLink(database, linkValues("user-b", OLD_DISCORD))).toBe(false);
  });

  it("lets exactly one of two concurrent links for the same Discord account win", async () => {
    const database = await getTestDatabase();
    const results = await Promise.all([
      insertDiscordLink(database, linkValues("user-a", OLD_DISCORD)),
      insertDiscordLink(database, linkValues("user-b", OLD_DISCORD)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await database.query.discordLink.findMany()).toHaveLength(1);
  });

  it("archives a link exactly once, so retries are safe", async () => {
    const database = await getTestDatabase();
    const values = linkValues("user-a", OLD_DISCORD);
    await insertDiscordLink(database, values);
    const link = { ...values, linkedAt: new Date() };
    expect(await archiveDiscordLink(database, link, "USER")).toBe(true);
    expect(await archiveDiscordLink(database, link, "USER")).toBe(false);
    expect(await database.query.discordLink.findMany()).toHaveLength(0);
    expect(await database.query.discordLinkHistory.findMany()).toEqual([
      expect.objectContaining({ id: values.id, userId: "user-a", reason: "USER" }),
    ]);
  });

  it("loads cooldown history, blocking sanctions and tombstone matches", async () => {
    const database = await getTestDatabase();
    await database.insert(discordLinkHistory).values({
      id: "old-link",
      userId: "user-b",
      discordId: OLD_DISCORD,
      discordUsername: "old",
      linkedAt: new Date(Date.now() - 10 * DAY),
      unlinkedAt: new Date(Date.now() - DAY),
      reason: "USER",
    });
    await database.insert(sanctionTombstone).values({
      userId: "deleted-user",
      sourceId: "report-deleted",
      sanction: "BAN",
      sanctionEndsAt: new Date(Date.now() + 100 * DAY),
      accountHashes: [discordTombstoneHash(OLD_DISCORD)],
    });
    await addSanction("user-a", "SILENCE_ACTIVATED", DISCORD_INDEFINITE_SANCTION_DAYS + 30);
    const { candidate } = await loadLinkCandidate(database, {
      userId: "user-a",
      discordId: OLD_DISCORD,
      discordCreatedAt: new Date("2016-04-30T11:18:25.796Z"),
    });
    expect(candidate.history).toHaveLength(1);
    expect(candidate.matchesSanctionTombstone).toBe(true);
    expect(candidate.hasBlockingSanction).toBe(true);
    // A short silence neither blocks linking nor bans on Discord.
    await resetTables(userReport);
    await addSanction("user-a", "SILENCE_ACTIVATED", 3);
    const shortSilence = await loadLinkCandidate(database, {
      userId: "user-a",
      discordId: OTHER_DISCORD,
      discordCreatedAt: new Date("2016-04-30T11:18:25.796Z"),
    });
    expect(shortSilence.candidate.hasBlockingSanction).toBe(false);
    expect(shortSilence.candidate.matchesSanctionTombstone).toBe(false);
  });

  it("links through the OAuth callback and pushes metadata, nickname and roles", async () => {
    const database = await getTestDatabase();
    const outcome = await linkThroughOAuth("user-a", clerkIdentity(OTHER_DISCORD));
    expect(outcome).toEqual({ result: "linked" });
    const link = await database.query.discordLink.findFirst({
      where: eq(discordLink.userId, "user-a"),
    });
    expect(link).toMatchObject({
      tokenSource: "OAUTH",
      discordId: OLD_DISCORD,
      discordUsername: "naruto_fan",
      clerkDiscordId: OTHER_DISCORD,
      syncedUsername: "Alpha",
      syncedVillageId: "village-a",
      syncedLevel: 20,
      syncError: null,
    });
    // Tokens are stored encrypted.
    expect(link?.accessToken).not.toContain("access-1");
    expect(calls.find((call) => call.path.endsWith("/role-connection"))?.body).toEqual({
      platform_name: "TheNinja-RPG",
      platform_username: "Alpha",
      metadata: { linked: "1", level: "20" },
    });
    expect(
      calls.find((call) => call.method === "PUT" && call.path === `/guilds/${GUILD}/members/${OLD_DISCORD}`)
        ?.body,
    ).toEqual({ access_token: "access-1", nick: "Alpha", roles: [VERIFIED_ROLE, VILLAGE_ROLE] });
    const logs = await database.query.actionLog.findMany({
      where: eq(actionLog.tableName, "discordLink"),
    });
    expect(logs.map((log) => log.relatedMsg)).toEqual(
      expect.arrayContaining([
        "Linked Discord naruto_fan",
        expect.stringContaining("Discord link flag"),
      ]),
    );
  });

  it("refuses a Discord account linked to another character and revokes its token", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-b", OLD_DISCORD));
    const outcome = await linkThroughOAuth("user-a", null);
    expect(outcome).toEqual({ result: "linked_elsewhere", hint: "B***o" });
    expect(calls.some((call) => call.path === "/oauth2/token/revoke")).toBe(true);
    expect(calls.some((call) => call.path.includes("/guilds/"))).toBe(false);
    expect(
      await database.query.discordLink.findFirst({ where: eq(discordLink.userId, "user-a") }),
    ).toBeUndefined();
  });

  it("refuses linking while banned", async () => {
    const database = await getTestDatabase();
    await database.update(userData).set({ isBanned: true }).where(eq(userData.userId, "user-a"));
    expect(await linkThroughOAuth("user-a", null)).toEqual({ result: "banned" });
  });

  it("bans the linked Discord account for an indefinite sanction and unbans when lifted", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-a", OLD_DISCORD));
    await addSanction("user-a", "BAN_ACTIVATED", DISCORD_INDEFINITE_SANCTION_DAYS + 1, "report-42");
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(1);
    expect((await syncDiscordMember(database, "user-a")).synced).toBe(true);
    const ban = calls.find((call) => call.method === "PUT" && call.path === `/guilds/${GUILD}/bans/${OLD_DISCORD}`);
    expect(ban?.reason).toBe("TNR report report-42: indefinite ban");
    expect(
      (await database.query.discordLink.findFirst())?.syncedBanned,
    ).toBe(true);
    // Unlinking is refused while the sanction runs.
    const caller = await callerFor(discordRouter, "user-a");
    expect((await caller.unlink()).success).toBe(false);

    await database
      .update(userReport)
      .set({ status: "REPORT_CLEARED" })
      .where(eq(userReport.id, "report-42"));
    calls = [];
    await reconcileDiscordLinks(database);
    expect(
      calls.some((call) => call.method === "DELETE" && call.path === `/guilds/${GUILD}/bans/${OLD_DISCORD}`),
    ).toBe(true);
    expect((await database.query.discordLink.findFirst())?.syncedBanned).toBe(false);
  });

  it("keeps a long ban indefinite after less than the window remains", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-a", OLD_DISCORD));
    // A two-year ban decided 400 days ago still has 330 days to run.
    await addSanction("user-a", "BAN_ACTIVATED", 330, "report-long", 400);
    await syncDiscordMember(database, "user-a");
    expect((await database.query.discordLink.findFirst())?.syncedBanned).toBe(true);
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(0);
    // A one-month ban decided today is not indefinite.
    await resetTables(userReport);
    await addSanction("user-a", "BAN_ACTIVATED", 30, "report-short");
    await syncDiscordMember(database, "user-a");
    expect((await database.query.discordLink.findFirst())?.syncedBanned).toBe(false);
  });

  it("re-applies a changed username and village role on the next sync", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-a", OLD_DISCORD));
    guildMember = { nick: "Alpha", roles: [VERIFIED_ROLE, VILLAGE_ROLE, "7777777777777777777"] };
    await syncDiscordMember(database, "user-a", { force: true });
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(0);
    await database
      .update(userData)
      .set({ username: "AlphaRenamed", villageId: "village-b" })
      .where(eq(userData.userId, "user-a"));
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(1);
    calls = [];
    await reconcileDiscordLinks(database);
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ nick: "AlphaRenamed" });
    // The old village role goes; unmanaged roles stay.
    expect(
      calls.filter((call) => call.method === "DELETE").map((call) => call.path),
    ).toEqual([`/guilds/${GUILD}/members/${OLD_DISCORD}/roles/${VILLAGE_ROLE}`]);
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(0);
  });

  it("does nothing on Discord while the feature is off", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-a", OLD_DISCORD));
    process.env.DISCORD_LINKING_ENABLED = "false";
    expect(await reconcileDiscordLinks(database)).toEqual({
      processed: 0,
      failed: 0,
      skipped: true,
    });
    expect(calls).toHaveLength(0);
  });

  it("unlinks: drops the Linked Role, archives the link and logs it", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-a", OLD_DISCORD));
    guildMember = { nick: "Alpha", roles: [VILLAGE_ROLE] };
    const caller = await callerFor(discordRouter, "user-a");
    expect((await caller.unlink()).success).toBe(true);
    expect(calls.find((call) => call.path.endsWith("/role-connection"))?.body).toMatchObject({
      metadata: { linked: "0", level: "0" },
    });
    expect(calls.some((call) => call.path === "/oauth2/token/revoke")).toBe(true);
    expect(await database.query.discordLink.findMany()).toHaveLength(0);
    expect(await database.query.discordLinkHistory.findMany()).toEqual([
      expect.objectContaining({ userId: "user-a", discordId: OLD_DISCORD, reason: "USER" }),
    ]);
  });

  it("captures the linked Discord id in the tombstone and removes the link on deletion", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-a", OLD_DISCORD));
    await addSanction("user-a", "BAN_ACTIVATED", 20);
    await recordSanctionTombstone(database, "user-a", {
      primaryEmailAddressId: null,
      emailAddresses: [],
      externalAccounts: [],
    });
    expect((await database.query.sanctionTombstone.findFirst())?.accountHashes).toEqual([
      discordTombstoneHash(OLD_DISCORD),
    ]);
    // Without an active report deletion never asks Clerk for the identity.
    await database.delete(userReport);
    await deleteUser(database, "user-a");
    expect(await database.query.discordLink.findMany()).toHaveLength(0);
    expect(await database.query.discordLinkHistory.findMany()).toEqual([
      expect.objectContaining({ userId: "user-a", reason: "ACCOUNT_DELETED" }),
    ]);
  });

  it("links from the Clerk Discord sign-in without a consent redirect", async () => {
    const database = await getTestDatabase();
    const config = getDiscordConfig();
    if (!config) throw new Error("config");
    fakeClerk();
    const grant = await resolveClerkDiscordGrant(config, "user-a");
    expect(grant).toMatchObject({ source: "CLERK", accessToken: "clerk-access", tokens: null });
    if (!grant) throw new Error("grant");
    const outcome = await completeDiscordLink(database, config, {
      userId: "user-a",
      grant,
      identity: clerkIdentity(),
    });
    expect(outcome).toEqual({ result: "linked" });
    const link = await database.query.discordLink.findFirst();
    expect(link).toMatchObject({
      userId: "user-a",
      discordId: OLD_DISCORD,
      clerkDiscordId: OLD_DISCORD,
      tokenSource: "CLERK",
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      syncError: null,
      syncedLevel: 20,
    });
    // Clerk's token pushes metadata and joins the server; no code exchange or revoke.
    expect(calls.some((call) => call.path.startsWith("/oauth2/token"))).toBe(false);
    expect(calls.find((call) => call.path.endsWith("/role-connection"))?.auth).toBe(
      "Bearer clerk-access",
    );
    expect(
      calls.find(
        (call) => call.method === "PUT" && call.path === `/guilds/${GUILD}/members/${OLD_DISCORD}`,
      )?.body,
    ).toMatchObject({ access_token: "clerk-access" });
    expect(needsDiscordRelink(link?.syncError)).toBe(false);
  });

  it("completes the link in the authorize route when Clerk's token has the scope", async () => {
    fakeClerk();
    vi.spyOn(clerk, "auth").mockResolvedValue({ userId: "user-a" } as never);
    const response = await authorizeDiscord(
      new Request("http://localhost:3000/api/discord/authorize", {
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/discord/link?result=linked&auto=1",
    );
    expect((await (await getTestDatabase()).query.discordLink.findFirst())?.tokenSource).toBe(
      "CLERK",
    );
  });

  it("falls back to the consent redirect when Clerk's token lacks the scope", async () => {
    const config = getDiscordConfig();
    if (!config) throw new Error("config");
    fakeClerk({
      tokens: [{ token: "old", scopes: ["identify", "email"], externalAccountId: "eac_discord" }],
    });
    expect(await resolveClerkDiscordGrant(config, "user-a")).toBeNull();
    vi.spyOn(clerk, "auth").mockResolvedValue({ userId: "user-a" } as never);
    const response = await authorizeDiscord(
      new Request("http://localhost:3000/api/discord/authorize", {
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(response.headers.get("location")).toStartWith("https://discord.com/oauth2/authorize");
    expect(await (await getTestDatabase()).query.discordLink.findMany()).toHaveLength(0);
  });

  it("uses the consent flow without a Discord sign-in, a cross-site start or a foreign token", async () => {
    const config = getDiscordConfig();
    if (!config) throw new Error("config");
    fakeClerk({ discordId: null });
    expect(await resolveClerkDiscordGrant(config, "user-a")).toBeNull();
    // A token Discord issued to another application cannot write this app's role connection.
    fakeClerk();
    authorization = { ...authorization, application: { id: "9999999999999999999" } };
    expect(await resolveClerkDiscordGrant(config, "user-a")).toBeNull();
    // Another site sending the player to the route never links without consent.
    authorization = { ...authorization, application: { id: ENV.DISCORD_CLIENT_ID } };
    vi.spyOn(clerk, "auth").mockResolvedValue({ userId: "user-a" } as never);
    const response = await authorizeDiscord(
      new Request("http://localhost:3000/api/discord/authorize", {
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(response.headers.get("location")).toStartWith("https://discord.com/oauth2/authorize");
  });

  it("applies the linking rules to Clerk grants and never revokes Clerk's token", async () => {
    const database = await getTestDatabase();
    const config = getDiscordConfig();
    if (!config) throw new Error("config");
    await insertDiscordLink(database, linkValues("user-b", OLD_DISCORD));
    fakeClerk();
    const grant = await resolveClerkDiscordGrant(config, "user-a");
    if (!grant) throw new Error("grant");
    expect(
      await completeDiscordLink(database, config, {
        userId: "user-a",
        grant,
        identity: clerkIdentity(),
      }),
    ).toEqual({ result: "linked_elsewhere", hint: "B***o" });
    await database.update(userData).set({ isBanned: true }).where(eq(userData.userId, "user-a"));
    await resetTables(discordLink);
    expect(
      await completeDiscordLink(database, config, {
        userId: "user-a",
        grant,
        identity: clerkIdentity(),
      }),
    ).toEqual({ result: "banned" });
    expect(calls.some((call) => call.path === "/oauth2/token/revoke")).toBe(false);
  });

  it("syncs a Clerk-sourced link with a fresh token from Clerk", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, {
      ...linkValues("user-a", OLD_DISCORD),
      tokenSource: "CLERK",
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      scopes: "identify role_connections.write",
    });
    const { getUserOauthAccessToken } = fakeClerk();
    expect((await syncDiscordMember(database, "user-a", { force: true })).synced).toBe(true);
    expect(getUserOauthAccessToken).toHaveBeenCalledWith("user-a", "discord");
    expect(calls.find((call) => call.path.endsWith("/role-connection"))?.auth).toBe(
      "Bearer clerk-access",
    );
    // guilds.join granted to Clerk later is picked up and used to join the server.
    const link = await database.query.discordLink.findFirst();
    expect(link?.scopes).toBe("identify email role_connections.write guilds.join");
    expect(
      calls.some(
        (call) => call.method === "PUT" && call.path === `/guilds/${GUILD}/members/${OLD_DISCORD}`,
      ),
    ).toBe(true);
    // Unlinking leaves Clerk's token alone.
    calls = [];
    expect((await (await callerFor(discordRouter, "user-a")).unlink()).success).toBe(true);
    expect(calls.some((call) => call.path === "/oauth2/token/revoke")).toBe(false);
  });

  it("asks for a re-link when Clerk no longer holds a usable token", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, {
      ...linkValues("user-a", OLD_DISCORD),
      tokenSource: "CLERK",
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
    });
    // The player replaced their Discord sign-in with another Discord account.
    fakeClerk({ discordId: OTHER_DISCORD });
    const result = await syncDiscordMember(database, "user-a", { force: true });
    expect(result.synced).toBe(false);
    expect(calls.some((call) => call.path.endsWith("/role-connection"))).toBe(false);
    const link = await database.query.discordLink.findFirst();
    expect(link?.syncError).toContain(DISCORD_RELINK_REQUIRED);
    // The profile reads this to offer "Re-link Discord".
    expect(needsDiscordRelink(link?.syncError)).toBe(true);
  });
});
