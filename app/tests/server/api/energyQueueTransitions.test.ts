// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  aiProfile,
  battle,
  battleHistory,
  gameSetting,
  sectorMap,
  trainingLog,
  userData,
  userVote,
  village,
} from "@/drizzle/schema";
import { getServerPusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { travelRouter } from "@/server/api/routers/travel";
import {
  invalidatePublishedMapCache,
  getSectorNeighborIds,
} from "@/server/utils/sectorMap";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const HOME = 30;
const AWAY = getSectorNeighborIds(HOME).east;
const USER = "queued-traveler";
const entries = [
  { stat: "offence" as const, energy: 100 },
  { stat: "defence" as const, energy: 100 },
];
const read = async () =>
  (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, USER),
  });
const patch = async (values: Partial<typeof userData.$inferInsert>) =>
  (await getTestDatabase())
    .update(userData)
    .set(values)
    .where(eq(userData.userId, USER));
const mapFor = (sector: number) => ({
  formatVersion: 1,
  sector,
  name: "Test map",
  width: 26,
  height: 26,
  tiles: Array.from({ length: 26 * 26 }, (_, index) => ({
    x: index % 26,
    y: Math.floor(index / 26),
    terrain: "grass",
    walkCost: 1,
    blocked: false,
    zone: "wilderness" as const,
    battleBiome: "default" as const,
  })),
  objects: [],
  anchors: [],
  exits: [],
  metadata: { importedAt: new Date().toISOString(), source: "tiled" as const },
});
const prepare = async (queue = entries) => {
  const db = await getTestDatabase();
  await db
    .insert(village)
    .values({ id: "home", name: "Home", sector: HOME, kageId: "kage" });
  await insertUsers([
    {
      userId: USER,
      username: USER,
      rank: "JONIN",
      status: "AWAKE",
      level: 1,
      villageId: "home",
      sector: HOME,
      longitude: 25,
      latitude: 10,
      isOutlaw: false,
      curEnergy: 0,
      regeneration: 100,
      energyTrainingQueue: queue,
      stealthActive: true,
      stealthActivatedAt: new Date(),
      regenAt: new Date(),
    },
  ]);
  await db
    .insert(userVote)
    .values({
      id: "vote-queued",
      userId: USER,
      secret: "secret01",
      lastVoteAt: new Date(),
    });
  await db
    .insert(sectorMap)
    .values(
      [HOME, AWAY].map((sector) => ({
        id: `map-${sector}`,
        sector,
        name: "Map",
        width: 26,
        height: 26,
        status: "PUBLISHED" as const,
        normalizedJson: mapFor(sector),
      })),
    );
};
const walk = async (sector: number, curLongitude: number, longitude: number) =>
  (await callerFor(travelRouter, USER)).moveInSector({
    sector,
    curLongitude,
    curLatitude: 10,
    longitude,
    latitude: 10,
    villageId: "home",
    level: 1,
    username: USER,
    avatar: "https://example.com/avatar.png",
    avatarLight: "https://example.com/avatar.png",
  });

describeWithDatabase("Energy queue state transitions", () => {
  afterEach(async () => {
    await resetTables(gameSetting);
  });
  beforeEach(async () => {
    await resetTables(
      battle,
      battleHistory,
      aiProfile,
      gameSetting,
      trainingLog,
      sectorMap,
      userVote,
      userData,
      village,
    );
    invalidatePublishedMapCache();
  });
  it("does not credit away-sector ticks after walking home", async () => {
    await prepare();
    expect((await walk(HOME, 25, 26)).success).toBe(true);
    await patch({ regenAt: new Date(Date.now() - 195_000) });
    expect((await walk(AWAY, 0, -1)).success).toBe(true);
    await fetchUpdatedUser({
      client: await getTestDatabase(),
      userId: USER,
      forceRegen: true,
    });
    const user = (await read())!;
    expect(user.offence).toBe(140);
    expect(user.defence).toBe(10);
    expect(user.curEnergy).toBe(0);
    expect(user.energyTrainingQueue).toEqual([entries[1]]);
  });
  it("preserves all travel pools and unfinished ticks without training during travel", async () => {
    await prepare();
    const regenAt = new Date(Date.now() - 195_000);
    await patch({
      status: "TRAVEL",
      sector: HOME,
      regenAt,
      curHealth: 0,
      curChakra: 0,
      curStamina: 0,
      maxHealth: 1000,
      maxChakra: 1000,
      maxStamina: 1000,
    });
    expect(
      (await (await callerFor(travelRouter, USER)).finishGlobalMove()).success,
    ).toBe(true);
    const arrived = (await read())!;
    expect(arrived.curEnergy).toBe(100);
    expect(arrived.curHealth).toBe(300);
    expect(arrived.curChakra).toBe(300);
    expect(arrived.curStamina).toBe(300);
    expect(arrived.regenAt.getTime()).toBe(regenAt.getTime() + 180_000);
    expect(arrived.energyTrainingQueue).toEqual(entries);
    await fetchUpdatedUser({
      client: await getTestDatabase(),
      userId: USER,
      forceRegen: true,
    });
    expect((await read())!.defence).toBe(10);
  });
  it("does not regenerate an empty queue when walking", async () => {
    await prepare([]);
    await patch({ regenAt: new Date(Date.now() - 195_000) });
    const before = (await read())!;
    expect((await walk(HOME, 25, 26)).success).toBe(true);
    const after = (await read())!;
    expect(after.curEnergy).toBe(before.curEnergy);
    expect(after.regenAt).toEqual(before.regenAt);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
  it.each(["success", "partial failure", "concurrent"] as const)(
    "settles pre-combat queues exactly once for %s",
    async (mode) => {
      await prepare();
      const db = await getTestDatabase();
      await patch({
        isOutlaw: true,
        regenAt: new Date(Date.now() - 195_000),
        stealthActive: false,
        curHealth: 0,
        curChakra: 0,
        curStamina: 0,
        maxHealth: 1000,
        maxChakra: 1000,
        maxStamina: 1000,
      });
      await insertUsers([
        {
          userId: "attacker",
          username: "Attacker",
          rank: "JONIN",
          level: 1,
          status: "AWAKE",
          isOutlaw: true,
          sector: HOME,
          longitude: 25,
          latitude: 10,
        },
      ]);
      await db
        .insert(aiProfile)
        .values({ id: "Default", userId: "default-ai", rules: [] });
      await db
        .insert(gameSetting)
        .values({
          id: "training-gain",
          name: "trainingGainMultiplier",
          value: 2,
          time: new Date(Date.now() + 86_400_000),
        });
      const trigger = vi
        .spyOn(getServerPusher(), "trigger")
        .mockResolvedValue({} as never);
      try {
        let injectFailure = mode === "partial failure";
        const racingDb = new Proxy(db, {
          get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (property !== "update") return value;
            return (table: typeof userData) => {
              const update = value.call(target, table);
              if (table !== userData || !injectFailure) return update;
              injectFailure = false;
              return {
                set: (values: Record<string, unknown>) => {
                  const builder = update.set(values);
                  return {
                    where: async (...conditions: unknown[]) => {
                      await db
                        .update(userData)
                        .set({ status: "HOSPITALIZED" })
                        .where(eq(userData.userId, "attacker"));
                      return builder.where(...conditions);
                    },
                  };
                },
              };
            };
          },
        });
        const start = () =>
          initiateBattle(
            {
              client: racingDb,
              userIds: ["attacker"],
              targetIds: [USER],
              sector: HOME,
              longitude: 25,
              latitude: 10,
              biome: "default",
            },
            "SPARRING",
          );
        const results =
          mode === "concurrent"
            ? await Promise.all([start(), start()])
            : [await start()];
        expect(results.filter((result) => result.success)).toHaveLength(
          mode === "partial failure" ? 0 : 1,
        );
        const result = results.find((result) => result.success);
        const user = (await read())!;
        expect(user.energyTrainingQueue).toEqual([]);
        expect(user.curEnergy).toBe(100);
        expect(user.offence).toBe(270);
        expect(user.defence).toBe(270);
        expect(user.experience).toBe(520);
        expect(user.curHealth).toBe(300);
        expect(user.curChakra).toBe(300);
        expect(user.curStamina).toBe(300);
        if (result) {
          const state = await db.query.battle.findFirst({
            where: eq(battle.id, result.battleId!),
          });
          expect(
            state!.usersState.find((fighter) => fighter.userId === USER)!.offence,
          ).toBe(270);
        } else {
          expect(user.status).toBe("AWAKE");
          expect(await db.select().from(battle)).toHaveLength(0);
        }
        expect(await db.select().from(trainingLog)).toHaveLength(2);
      } finally {
        trigger.mockRestore();
      }
    },
  );
});
