import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { gameSetting, quest, territoryWar, territoryWarScore, war, village } from "@/drizzle/schema";
import { claimDiscordEventDelivery, finishDiscordEventDelivery, initializeDiscordEventDelivery, listDiscordTerritoryWars } from "@/queries/discordEvents";
import { discordEventConfig, discordEventPayload, syncDiscordEvents } from "@/server/utils/discord/events";
import { insertQuests } from "../../../setup/factories";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

const env = process.env as Record<string, string | undefined>;
const keys = ["NODE_ENV", "DISCORD_EVENT_UPDATES", "DISCORD_RAIDS_ROLE_ID", "DISCORD_WARS_ROLE_ID", "DISCORD_TERRITORY_WARS_ROLE_ID"];
const saved = Object.fromEntries(keys.map(key => [key, env[key]]));
const now = new Date("2026-10-29T12:00:00Z");
let posts: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;
beforeEach(() => {
  env.DISCORD_EVENT_UPDATES = "https://discord.com/api/webhooks/123/fixture";
  env.DISCORD_RAIDS_ROLE_ID = "111"; env.DISCORD_WARS_ROLE_ID = "222"; env.DISCORD_TERRITORY_WARS_ROLE_ID = "333";
  posts = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"id":"confirmed"}'));
});
afterEach(() => {
  posts.mockRestore();
  for (const key of keys) { if (saved[key] === undefined) delete env[key]; else env[key] = saved[key]; }
});
it("restricts mentions and caps Discord content length", () => {
  const payload = discordEventPayload("111", "@everyone <@&222> " + "x".repeat(2500));
  expect(payload.content.length).toBe(2000);
  expect(payload.allowed_mentions).toEqual({ parse: [], roles: ["111"], users: [], replied_user: false });
});
it("fails closed for missing roles, non-Discord URLs and non-HTTPS webhooks", () => {
  for (const url of ["", "https://discord.com.evil.test/api/webhooks/1/token", "http://discord.com/api/webhooks/1/token"]) {
    env.DISCORD_EVENT_UPDATES = url; expect(discordEventConfig()).toBeNull();
  }
});
it("does no database/network work under the test runner", async () => {
  await syncDiscordEvents(null as never, now);
  expect(posts).not.toHaveBeenCalled();
});

describeWithDatabase("Discord event delivery receipts", () => {
  beforeEach(async () => {
    await resetTables(gameSetting, quest, territoryWarScore, territoryWar, war, village);
  });
  const seed = async () => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "raid", name: "Boss", questType: "raid", createdAt: now, raidBossCurrentHealth: 100, raidEndsAt: new Date(now.getTime() + 600_000) }]);
    env.NODE_ENV = "development";
    return db;
  };
  it("sends starts and ends once across repeat and concurrent ticks", async () => {
    const db = await seed();
    await Promise.all([syncDiscordEvents(db, now), syncDiscordEvents(db, now)]);
    expect(posts).toHaveBeenCalledTimes(1);
    await db.update(quest).set({ raidBossCurrentHealth: 0 });
    await Promise.all([syncDiscordEvents(db, new Date(now.getTime() + 60_000)), syncDiscordEvents(db, new Date(now.getTime() + 60_000))]);
    expect(posts).toHaveBeenCalledTimes(2);
    await syncDiscordEvents(db, new Date(now.getTime() + 120_000));
    expect(posts).toHaveBeenCalledTimes(2);
    expect(String(posts.mock.calls[0]![0])).toContain("wait=true");
    const payload = JSON.parse(String(posts.mock.calls[0]![1]?.body));
    expect(payload.allowed_mentions.roles).toEqual(["111"]);
  });
  it("retries rejected posts and stale leases without consuming delivery", async () => {
    const db = await seed();
    posts.mockResolvedValueOnce(new Response("limited", { status: 429 }));
    await syncDiscordEvents(db, now);
    await syncDiscordEvents(db, new Date(now.getTime() + 60_000));
    expect(posts).toHaveBeenCalledTimes(2);
    await syncDiscordEvents(db, new Date(now.getTime() + 660_000));
    expect(posts).toHaveBeenCalledTimes(3); // deadline ended; end is a separate alert
    const id = "discord-event:test-lease";
    await initializeDiscordEventDelivery(db, id);
    expect((await claimDiscordEventDelivery(db, id, now, 120_000)).rowsAffected).toBe(1);
    expect((await claimDiscordEventDelivery(db, id, new Date(now.getTime() + 60_000), 120_000)).rowsAffected).toBe(0);
    const later = new Date(now.getTime() + 180_000);
    expect((await claimDiscordEventDelivery(db, id, later, 120_000)).rowsAffected).toBe(1);
    expect((await finishDiscordEventDelivery(db, id, now, true)).rowsAffected).toBe(0);
    expect((await finishDiscordEventDelivery(db, id, later, true)).rowsAffected).toBe(1);
  });
  it("announces war and faction raid results after their activation marker", async () => {
    const db = await getTestDatabase();
    await db.insert(village).values([{ id: "a", name: "Akikaze", kageId: "chief", sector: 1 }, { id: "b", name: "Hyorin", kageId: "other", sector: 2 }]);
    await db.insert(gameSetting).values({ id: "discord-event:wars:enabled", name: "discord-event:wars:enabled", time: new Date(now.getTime() - 60_000), value: 1 });
    await db.insert(war).values(["VILLAGE_WAR", "WAR_RAID"].map((type) => ({ id: type, type: type as "VILLAGE_WAR" | "WAR_RAID", attackerVillageId: "a", defenderVillageId: "b", startedAt: new Date(now.getTime() - 60_000), endedAt: now, status: "ATTACKER_VICTORY" as const })));
    env.NODE_ENV = "development";
    await syncDiscordEvents(db, now);
    expect(posts).toHaveBeenCalledTimes(4);
    const messages = posts.mock.calls.map(call => JSON.parse(String(call[1]?.body)).content as string);
    expect(messages.filter(message => message.includes("Winner: **Akikaze**"))).toHaveLength(2);
  });
  it("reads territory resolution and tied winners in one statement", async () => {
    const db = await getTestDatabase();
    await db.insert(territoryWar).values({ id: "event", predecessorId: "initial", guardianId: "guardian", sector: 42, startsAt: now, endsAt: now, resolvedAt: now });
    await db.insert(territoryWarScore).values(["Akikaze", "Faction"].map(name => ({ warId: "event", competitorId: name, name, rewarded: true })));
    expect((await listDiscordTerritoryWars(db))[0]?.winners.sort()).toEqual(["Akikaze", "Faction"]);
    expect((await db.query.gameSetting.findMany({ where: eq(gameSetting.value, 1) }))).toHaveLength(0);
  });
});
