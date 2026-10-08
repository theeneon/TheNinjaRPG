// @vitest-environment node
import {eq} from "drizzle-orm";
import {beforeEach, expect, it} from "vitest";
import {CombatStatNames, getUserCaps} from "@/drizzle/constants";
import {bloodline, item, userItem, quest, questHistory, trainingLog, userData, userVote} from "@/drizzle/schema";
import {fetchUpdatedUser} from "@/server/api/routers/profile";
import {trainRouter} from "@/server/api/routers/train";
import {insertItems, insertUserItems, insertUsers} from "../../setup/factories";
import {callerFor, describeWithDatabase, getTestDatabase, resetTables} from "../../setup/testDatabase";
const USER_ID = "trainee";
const SESSION_GAIN = 100;
const MINUTE = 60 * 1000;
const { mastery_cap: GENIN_MASTERY_CAP } = getUserCaps("GENIN");

const caller = () => callerFor(trainRouter, USER_ID);

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * MINUTE);

const trainee = async (patch: Record<string, unknown> = {}) => {
  await insertUsers([
    {
      userId: USER_ID,
      username: "Trainee",
      status: "AWAKE",
      rank: "GENIN",
      isOutlaw: true,
      trainingSpeed: "15min",
      ...patch,
    } as never,
  ]);
  // fetchUpdatedUser creates a missing vote row, and parallel requests would race on it
  const database = await getTestDatabase();
  await database
    .insert(userVote)
    .values({
      id: "vote-trainee",
      userId: USER_ID,
      secret: "secret01",
      lastVoteAt: new Date(),
    });
};

const readUser = async () => {
  const database = await getTestDatabase();
  const [user] = await database
    .select()
    .from(userData)
    .where(eq(userData.userId, USER_ID));
  if (!user) throw new Error("trainee missing");
  return user;
};

const readLogs = async () => {
  const database = await getTestDatabase();
  return database.select().from(trainingLog).where(eq(trainingLog.userId, USER_ID));
};

const backdate = async (patch: Partial<typeof userData.$inferInsert>) => {
  const database = await getTestDatabase();
  await database.update(userData).set(patch).where(eq(userData.userId, USER_ID));
};

describeWithDatabase("Energy and mastery training against a real MySQL", () => {
  beforeEach(async () => { await resetTables(trainingLog, questHistory, quest, userVote, userItem, item, userData, bloodline); });

  it("returns effective profile masteries from bloodline and eligible equipment without changing stored stats", async () => {
    const database = await getTestDatabase();
    const tag = {type: "increasemastery", masteryTypes: ["Ninjutsu"], power: 100, powerPerLevel: 0, calculation: "static", rounds: 1} as const;
    await database.insert(bloodline).values({id: "mastery-line", name: "Mastery Line", rank: "D", image: "", description: "", effects: [tag as never]});
    await trainee({bloodlineId: "mastery-line", ninjutsuMastery: 10});
    await insertItems([{id: "mastery-armor", itemType: "ARMOR", effects: [{...tag, power: 500}], requiredNinjutsuMastery: 100} as never]);
    await insertUserItems([{id: "worn-armor", userId: USER_ID, itemId: "mastery-armor", equipped: "CHEST", durability: 100, level: 1}]);
    const refreshed = await fetchUpdatedUser({client: database, userId: USER_ID});
    expect(refreshed.user?.effectiveMasteries.ninjutsuMastery).toBe(610);
    expect(refreshed.user?.ninjutsuMastery).toBe(10);
    expect((await readUser()).ninjutsuMastery).toBe(10);
  });

  it.each(CombatStatNames)("spends Energy only on %s and grants matching XP", async stat => {
    await trainee({curEnergy: 100, regeneration: 0});
    const before = await readUser();
    const result = await (await caller()).startTraining({stat, energy: 10});
    expect(result.success).toBe(true);
    const after = await readUser();
    expect(after.curEnergy).toBe(90);
    expect(after.experience - before.experience).toBeCloseTo(13);
    for (const other of CombatStatNames) expect(after[other] - before[other]).toBeCloseTo(other === stat ? 13 : 0);
    expect(await readLogs()).toHaveLength(1);
  });

  it("Energy training retains the Genin sensei bonus", async () => {
    await trainee({ curEnergy: 100, regeneration: 0, senseiId: "sensei" });
    const before = await readUser();
    const result = await (await caller()).startTraining({ stat: "offence", energy: 100 });
    expect(result.success).toBe(true);
    const after = await readUser();
    expect(after.offence - before.offence).toBeCloseTo(136.5);
    expect(after.curEnergy).toBe(0);
  });

  it("Energy training retains reduced gains after joining a village", async () => {
    await trainee({ rank: "JONIN", curEnergy: 100, regeneration: 0, joinedVillageAt: new Date() });
    const before = await readUser();
    const result = await (await caller()).startTraining({ stat: "offence", energy: 100 });
    expect(result.success).toBe(true);
    const after = await readUser();
    expect(after.offence - before.offence).toBeCloseTo(65);
    expect(after.curEnergy).toBe(0);
  });

  it("rejects overspending without granting stats", async () => {
    await trainee({curEnergy: 5, regeneration: 0});
    const before = await readUser();
    expect((await (await caller()).startTraining({stat: "offence", energy: 6})).success).toBe(false);
    expect((await readUser()).offence).toBe(before.offence);
    expect((await readUser()).curEnergy).toBe(5);
  });

  it("rejects a spend too small to reduce the stored Energy balance", async () => {
    await trainee({curEnergy: 100, regeneration: 0});
    const before = await readUser();
    const result = await (await caller()).startTraining({stat: "offence", energy: 4e-15});
    expect(result.success).toBe(false);
    const after = await readUser();
    expect(after.curEnergy).toBe(before.curEnergy);
    expect(after.offence).toBe(before.offence);
    expect(after.experience).toBe(before.experience);
    expect(await readLogs()).toHaveLength(0);
  });

  it("concurrent spends cannot reuse the same Energy", async () => {
    await trainee({curEnergy: 10, regeneration: 0});
    const api = await caller();
    const results = await Promise.all([api.startTraining({stat: "offence", energy: 10}), api.startTraining({stat: "defence", energy: 10})]);
    expect(results.filter(result => result.success)).toHaveLength(1);
    const after = await readUser();
    expect(after.curEnergy).toBe(0);
    expect(after.experience).toBeCloseTo(13);
    expect(await readLogs()).toHaveLength(1);
  });

  it("does not let a delayed profile refresh restore Energy already spent on training", async () => {
    await trainee({curEnergy: 10, regeneration: 0});
    const database = await getTestDatabase();
    await fetchUpdatedUser({client: database, userId: USER_ID, forceRegen: true});
    const api = await caller();
    let spent = false;
    const delayedDatabase = new Proxy(database, {
      get(target, key, receiver) {
        if (key !== "update") return Reflect.get(target, key, receiver);
        return (table: Parameters<typeof database.update>[0]) => {
          const builder = database.update(table);
          return {
            set(values: Parameters<typeof builder.set>[0]) {
              const update = builder.set(values);
              return {
                async where(condition: Parameters<typeof update.where>[0]) {
                  if (table === userData && "primaryElement" in values && !spent) {
                    spent = true;
                    expect((await api.startTraining({stat: "offence", energy: 10})).success).toBe(true);
                  }
                  return update.where(condition);
                },
              };
            },
          };
        };
      },
    });
    const refreshed = await fetchUpdatedUser({client: delayedDatabase, userId: USER_ID, forceRegen: true});
    expect(spent).toBe(true);
    expect(refreshed.user?.curEnergy).toBe(0);
    expect((await readUser()).curEnergy).toBe(0);
    expect((await api.startTraining({stat: "defence", energy: 10})).success).toBe(false);
    expect((await readUser()).experience).toBeCloseTo(13);
    expect(await readLogs()).toHaveLength(1);
  });

  it("credits an elapsed regeneration interval once across simultaneous profile refreshes", async () => {
    await trainee({level: 2, curEnergy: 0, regeneration: 5});
    const database = await getTestDatabase();
    const hydrated = await fetchUpdatedUser({client: database, userId: USER_ID, forceRegen: true});
    const regenAt = new Date(Date.now() - 135_000);
    await backdate({curEnergy: 0, regenAt});
    await Promise.all(Array.from({length: 8}, () => fetchUpdatedUser({client: database, userId: USER_ID, forceRegen: true})));
    const after = await readUser();
    expect(after.curEnergy).toBe(2 * hydrated.user!.regeneration);
    expect(after.regenAt.getTime()).toBe(regenAt.getTime() + 120_000);
  });

  it("spends only enough Energy to reach the cap and preserves stored overflow", async () => {
    const cap = getUserCaps("GENIN").stats_cap;
    await trainee({offence: cap - 1.3, curEnergy: 100, regeneration: 0});
    expect((await (await caller()).startTraining({stat: "offence", energy: 100})).success).toBe(true);
    const after = await readUser();
    expect(after.offence).toBeCloseTo(cap);
    expect(after.curEnergy).toBeCloseTo(99);
    await backdate({offence: cap + 100});
    expect((await (await caller()).startTraining({stat: "offence", energy: 1})).success).toBe(false);
    expect((await readUser()).offence).toBe(cap + 100);
  });

  it("timed mastery costs no Energy or XP and can run alongside instant stat training", async () => {
    await trainee({curEnergy: 100, regeneration: 0});
    const api = await caller();
    expect((await api.startMasteryTraining({stat: "ninjutsuMastery"})).success).toBe(true);
    expect((await api.startTraining({stat: "offence", energy: 10})).success).toBe(true);
    await backdate({masteryTrainingStartedAt: minutesAgo(30)});
    const before = await readUser();
    const result = await api.stopMasteryTraining({});
    expect(result.success).toBe(true);
    expect(result.data?.amount).toBe(100);
    expect(result.data?.creditedMinutes).toBeCloseTo(30, 0);
    const after = await readUser();
    expect(after.curEnergy).toBe(before.curEnergy);
    expect(after.experience).toBe(before.experience);
    expect(after.dailyTrainings).toBe(1);
    expect((await api.stopMasteryTraining({})).success).toBe(false);
  });

  it.each(["AWAKE", "ASLEEP"] as const)(
    "%s profile refreshes preserve unfinished regeneration ticks", async status => {
      const regenAt = new Date(Date.now() - 75000);
      await trainee({level: 2, status, curEnergy: 0, curHealth: 0, curChakra: 0, curStamina: 0, regeneration: 5, regenAt});
      const database = await getTestDatabase();
      const fetch = () => fetchUpdatedUser({client: database, userId: USER_ID, forceRegen: true});
      const hydrated = await fetch();
      const first = await readUser();
      expect(first.curEnergy).toBe(hydrated.user?.regeneration);
      expect(first.regenAt.getTime()).toBe(regenAt.getTime() + 60000);
      await fetch();
      const second = await readUser();
      expect(second.regenAt.getTime()).toBe(first.regenAt.getTime());
      for (const pool of ["curEnergy", "curHealth", "curChakra", "curStamina"] as const) {
        expect(second[pool]).toBe(first[pool]);
      }
    },
  );

  it("Energy regenerates while mastery runs, capped at level capacity", async () => {
    await trainee({level: 2, curEnergy: 0, regeneration: 60, regenAt: minutesAgo(10), currentlyTrainingMastery: "ninjutsuMastery", masteryTrainingStartedAt: minutesAgo(5)});
    expect((await (await caller()).startTraining({stat: "offence", energy: 10})).success).toBe(true);
    expect((await readUser()).curEnergy).toBeCloseTo(140);
  });
});
