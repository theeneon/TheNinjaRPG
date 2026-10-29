import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { aiProfile, battle, item, quest, questHistory, userData, userItem, userPet } from "@/drizzle/schema";
import { updateUser } from "@/libs/combat/database";
import { filterCombatQuests } from "@/libs/combat/quests";
import { captureCombatCacheSnapshot, combatProfilePatch } from "@/libs/combat/userCache";
import { calcBattleResult } from "@/libs/combat/util";
import { Pusher, type PusherClient } from "@/libs/pusher";
import { getActiveObjectives, getNewTrackers, mockAchievementHistoryEntries } from "@/libs/quest";
import { initiateBattle } from "@/server/api/routers/combat";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { AllObjectives, QuestTracker } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertItems, insertQuestHistory, insertQuests, insertUserItems, insertUsers } from "../../setup/factories";
import { describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../setup/testDatabase";
import { makeBattleUser, makeCompleteBattle } from "./helpers/battleScenario";

describeWithDatabase("combat profile cache inventory confirmation", () => {
  beforeEach(async () => {
    await resetTables(userPet, battle, aiProfile, questHistory, quest, userItem, item, userData);
    await insertUsers([{ userId: "cache-player", username: "CachePlayer", status: "BATTLE", battleId: "cache-fight", rank: "NONE", curEnergy: 10, regeneration: 0 }]);
    await insertItems([{ id: "cache-consumable", itemType: "CONSUMABLE" }]);
    await insertUserItems([{ id: "cache-stack", userId: "cache-player", itemId: "cache-consumable", quantity: 2, equipped: "ITEM_1", durability: 100 }]);
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([{ tombstone: false, quantity: 1 }, { tombstone: true, quantity: 1 }, { tombstone: false, quantity: 2 }, { tombstone: true, quantity: 2 }])("returns an inventory patch only when the stack write confirms its existence (%s)", async ({ tombstone, quantity }) => {
    const database = await getTestDatabase();
    const original = await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player"), with: { items: { with: { item: true } } } });
    if (!original) throw new Error("Missing combat profile");
    const snapshot = captureCombatCacheSnapshot(original);
    const battleItem = { ...original.items[0]!, quantity, dropChancePerc: 0, lastUsedRound: -1, originalCooldown: 0 };
    const state = makeCompleteBattle({ id: "cache-fight", battleType: "ARENA", rewardScaling: 1, usersState: [
      makeBattleUser("cache-player", { direction: "left", rank: "NONE", isAi: false, isSummon: false, curHealth: 100, sector: 1, items: [battleItem] }),
      makeBattleUser("cache-ai", { direction: "right", isAi: true, curHealth: 0, sector: 1, leftBattle: true }),
    ], extraState: { profileCacheSnapshots: { "cache-player": snapshot }, energyCapacity: { "cache-player": 100 }, energyRegeneration: { "cache-player": 0 } } });
    const result = calcBattleResult(state, "cache-player", [])!;
    result.villagePrestige = 0; result.villageTokens = 0; result.anbuPoints = 0; result.clanPoints = 0;
    if (tombstone) await database.update(userItem).set({ quantity: 0 }).where(eq(userItem.id, "cache-stack"));
    await updateUser(database, { trigger: async () => {} } as unknown as PusherClient, state, result, "cache-player");
    const savedItem = await database.query.userItem.findFirst({ where: eq(userItem.id, "cache-stack") });
    expect(savedItem?.quantity).toBe(tombstone ? 0 : quantity);
    if (tombstone) expect(result.profileUpdate).toBeUndefined();
    else expect(result.profileUpdate?.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: "cache-stack", quantity })]));
    expect((await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player") }))?.battleId).toBeNull();
  });

  it.each(["ready", "disabled", "changed selection", "changed rank", "disabled without recovery"])("confirms companion XP atomically and preserves player rewards when eligibility changes (%s)", async (condition) => {
    const eligible = condition === "ready";
    const database = await getTestDatabase();
    await database.update(userData).set({ rank: "GENIN", activePetId: "cache-pet", petExperience: 40 }).where(eq(userData.userId, "cache-player"));
    await database.insert(userPet).values({ id: "cache-pet", userId: "cache-player", name: "Miso", speciesId: "cache-species", paletteIndex: 0, characteristicIndex: 0, auraIndex: 0, rank: 1, artRank: 1, avatar: "https://example.com/pet.webp", generationStatus: "READY" });
    const original = (await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player"), with: { items: { with: { item: true } } } }))!;
    const current = { ...original, titles: [], userQuests: [], questData: [] } as unknown as NonNullable<UserWithRelations>;
    const state = makeCompleteBattle({ id: "cache-fight", battleType: "ARENA", rewardScaling: 1, usersState: [
      makeBattleUser("cache-player", { direction: "left", rank: "GENIN", isAi: false, isSummon: false, curHealth: 100, sector: 1, items: [] }),
      makeBattleUser("cache-ai", { direction: "right", isAi: true, curHealth: 0, sector: 1, leftBattle: true }),
    ], extraState: { profileCacheSnapshots: { "cache-player": captureCombatCacheSnapshot(original) }, petIdsByOwner: { "cache-player": "cache-pet" }, energyCapacity: { "cache-player": 100 }, energyRegeneration: { "cache-player": 0 } } });
    const result = calcBattleResult(state, "cache-player", [])!;
    result.experience = 5.49; result.earnedExperience = 7.49;
    result.villagePrestige = 0; result.villageTokens = 0; result.anbuPoints = 0; result.clanPoints = 0;
    if (condition === "disabled without recovery") delete state.extraState.energyCapacity;
    if (condition.startsWith("disabled")) await database.update(userPet).set({ battleEnabled: false }).where(eq(userPet.id, "cache-pet"));
    if (condition === "changed selection") await database.update(userData).set({ activePetId: null }).where(eq(userData.userId, "cache-player"));
    if (condition === "changed rank") await database.update(userData).set({ rank: "NONE" }).where(eq(userData.userId, "cache-player"));
    const { statements } = await recordQueries(() => updateUser(database, { trigger: async () => {} } as unknown as PusherClient, state, result, "cache-player"));
    expect(statements.some((statement) => /^select\b/i.test(statement))).toBe(false);
    expect(statements.filter((statement) => /^update `UserData` /i.test(statement))).toHaveLength(eligible || condition === "disabled without recovery" ? 1 : 2);
    const saved = (await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player") }))!;
    expect(saved).toMatchObject({ experience: original.experience + 5, earnedExperience: original.earnedExperience + 7, battleId: null, petExperience: eligible ? 52 : 40 });
    if (!eligible) expect(result.profileUpdate).toBeUndefined();
    else {
      expect(result.profileUpdate?.userDelta.petExperience).toBe(12);
      const key = [["profile", "getUser"], { type: "query" }];
      const client = new QueryClient();
      client.setQueryData(key, { userData: current });
      let reads = 0;
      const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: async () => { reads++; return { userData: current }; } });
      const stop = observer.subscribe(() => undefined);
      try {
        const revision = prepareUserUpdate(client, key);
        await updateUserCache(client, key, (user) => combatProfilePatch(user, result.profileUpdate!), { revision, delta: result.profileUpdate!.userDelta });
        expect(client.getQueryData<{ userData: typeof current }>(key)?.userData.petExperience).toBe(52);
        expect(reads).toBe(0);
      } finally { stop(); client.clear(); }
    }
  });

  it("preserves omitted quest progress in storage and the client cache without publishing unloaded trackers or reading", async () => {
    const database = await getTestDatabase();
    const omitted = QuestTracker.parse({ id: "unloaded-achievement", goals: [{ id: "earned", value: 7, done: true }] });
    await database.update(userData).set({ questData: [omitted] }).where(eq(userData.userId, "cache-player"));
    const original = await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player"), with: { items: { with: { item: true } } } });
    if (!original) throw new Error("Missing combat profile");
    const state = makeCompleteBattle({ id: "cache-fight", battleType: "ARENA", rewardScaling: 1, usersState: [
      makeBattleUser("cache-player", { direction: "left", rank: "NONE", isAi: false, isSummon: false, curHealth: 100, sector: 1, items: [] }),
      makeBattleUser("cache-ai", { direction: "right", isAi: true, curHealth: 0, sector: 1, leftBattle: true }),
    ], extraState: {
      profileCacheSnapshots: { "cache-player": captureCombatCacheSnapshot(original) },
      energyCapacity: { "cache-player": 100 }, energyRegeneration: { "cache-player": 0 },
      questData: { "cache-player": original.questData ?? [] }, userQuests: { "cache-player": [] },
    } });
    const result = calcBattleResult(state, "cache-player", [])!;
    result.villagePrestige = 0; result.villageTokens = 0; result.anbuPoints = 0; result.clanPoints = 0;
    const { statements } = await recordQueries(() => updateUser(database, { trigger: async () => {} } as unknown as PusherClient, state, result, "cache-player"));
    expect(statements.some((statement) => /^select\b/i.test(statement))).toBe(false);
    expect((await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player") }))?.questData).toEqual([omitted]);
    expect(result.profileUpdate?.userPatch.questData).toEqual([]);
    expect(combatProfilePatch({ ...original, titles: [], questData: [omitted] } as unknown as NonNullable<UserWithRelations>, result.profileUpdate!)?.questData).toEqual([omitted]);
  });

  it("removes an event tracker and its map target when the loaded quest expires during combat", async () => {
    const database = await getTestDatabase();
    await insertQuests([{ id: "timed-event", questType: "event", maxAttempts: 100, maxCompletes: 100,
      endsAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      content: { objectives: [AllObjectives.parse({ id: "target", task: "move_to_location", sector: 1, longitude: 4, latitude: 5, sectorType: "specific", sectorList: [], locationType: "specific", hideLocation: false })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] },
    }]);
    await insertQuestHistory([{ userId: "cache-player", questId: "timed-event", questType: "event" }]);
    const original = await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player"), with: { items: { with: { item: true } }, userQuests: { with: { quest: true } } } });
    if (!original) throw new Error("Missing combat profile");
    const current = { ...original, titles: [], completedQuests: [] } as unknown as NonNullable<UserWithRelations>;
    current.questData = getNewTrackers(current, [{ task: "any" }]).trackers;
    expect(current.questData.map((tracker) => tracker.id)).toEqual(["timed-event"]);
    expect(getActiveObjectives(current)).toHaveLength(1);
    const loaded = filterCombatQuests(structuredClone(current.userQuests));
    loaded[0]!.quest.endsAt = new Date(Date.now() - 1000).toISOString();
    const state = makeCompleteBattle({ id: "cache-fight", battleType: "ARENA", rewardScaling: 1, usersState: [
      makeBattleUser("cache-player", { direction: "left", rank: "NONE", level: original.level, originalLevel: original.level, isAi: false, isSummon: false, curHealth: 100, sector: 1, items: [] }),
      makeBattleUser("cache-ai", { direction: "right", isAi: true, curHealth: 0, sector: 1, leftBattle: true }),
    ], extraState: {
      profileCacheSnapshots: { "cache-player": captureCombatCacheSnapshot(original) },
      energyCapacity: { "cache-player": 100 }, energyRegeneration: { "cache-player": 0 },
      questData: { "cache-player": current.questData }, userQuests: { "cache-player": loaded },
    } });
    const result = calcBattleResult(state, "cache-player", [])!;
    result.villagePrestige = 0; result.villageTokens = 0; result.anbuPoints = 0; result.clanPoints = 0;
    const { statements } = await recordQueries(() => updateUser(database, { trigger: async () => {} } as unknown as PusherClient, state, result, "cache-player"));
    expect(statements.some((statement) => /^select\b/i.test(statement))).toBe(false);
    expect((await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player") }))?.questData).toEqual([]);
    expect(result.profileUpdate?.userPatch.questData).toEqual([]);
    const patch = combatProfilePatch(current, result.profileUpdate!);
    expect(patch?.questData).toEqual([]);
    expect(getActiveObjectives({ ...current, ...patch })).toEqual([]);
    expect(current.questData.map((tracker) => tracker.id)).toEqual(["timed-event"]);
  });

  it.each([{ questType: "mission", party: false }, { questType: "achievement", party: false }, { questType: "mission", party: true }] as const)("projects a completed $questType objective only when no progression is pending (party=$party)", async ({ questType, party }) => {
    const database = await getTestDatabase();
    await insertQuests([{ id: "complete-goal", questType, maxAttempts: 100, maxCompletes: 100,
      content: { objectives: [AllObjectives.parse({ id: "kill", task: "arena_kills", value: 1 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] },
    }]);
    await insertQuestHistory([{ userId: "cache-player", questId: "complete-goal", questType }]);
    if (party) await database.update(userData).set({ questPartyId: "cache-party" }).where(eq(userData.userId, "cache-player"));
    const original = (await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player"), with: { items: { with: { item: true } }, userQuests: { with: { quest: true } } } }))!;
    const current = { ...original, titles: [], completedQuests: [] } as unknown as NonNullable<UserWithRelations>;
    current.questData = getNewTrackers(current, [{ task: "any" }]).trackers;
    if (party) current.questData[0]!.party = { id: "cache-party", generation: 0, contributions: [] };
    const state = makeCompleteBattle({ id: "cache-fight", battleType: "ARENA", rewardScaling: 1, usersState: [
      makeBattleUser("cache-player", { direction: "left", status: "AWAKE", questPartyId: original.questPartyId, rank: "NONE", level: original.level, originalLevel: original.level, isAi: false, isSummon: false, curHealth: 100, sector: 1, items: [] }),
      makeBattleUser("cache-ai", { direction: "right", isAi: true, curHealth: 0, sector: 1, leftBattle: true }),
    ], extraState: { profileCacheSnapshots: { "cache-player": captureCombatCacheSnapshot(original) },
      energyCapacity: { "cache-player": 100 }, energyRegeneration: { "cache-player": 0 },
      questData: { "cache-player": current.questData }, userQuests: { "cache-player": filterCombatQuests(structuredClone(current.userQuests)) },
    } });
    const result = calcBattleResult(state, "cache-player", [])!;
    result.villagePrestige = 0; result.villageTokens = 0; result.anbuPoints = 0; result.clanPoints = 0;
    const { statements } = await recordQueries(() => updateUser(database, { trigger: async () => {} } as unknown as PusherClient, state, result, "cache-player"));
    expect(statements.some((statement) => /^select\b/i.test(statement))).toBe(false);
    if (questType === "achievement" || party) expect(result.profileUpdate).toBeUndefined();
    else {
      const patch = combatProfilePatch(current, result.profileUpdate!);
      expect(patch?.questData?.find((tracker) => tracker.id === "complete-goal")?.goals[0]?.done).toBe(true);
      expect(patch?.questData).toEqual((await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player") }))?.questData);
    }
    if (party) {
      const saved = (await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player") }))!;
      expect(saved.questData?.find((tracker) => tracker.id === "complete-goal")?.party?.contributions).toMatchObject([{ id: "kill", done: true }]);
    }
  });

  it("keeps loaded and omitted mock achievement trackers visible without persisting them", async () => {
    const database = await getTestDatabase();
    await insertQuests(["arena_kills", "user_level"].map((task, index) => ({
      id: index === 0 ? "loaded-arena" : "omitted-level", questType: "achievement", maxAttempts: 100, maxCompletes: 100,
      content: { objectives: [AllObjectives.parse({ id: "goal", task, value: 10000 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] },
    })));
    const original = await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player"), with: { items: { with: { item: true } } } });
    if (!original) throw new Error("Missing combat profile");
    const current = { ...original, titles: [], userQuests: [], completedQuests: [] } as unknown as NonNullable<UserWithRelations>;
    current.userQuests = mockAchievementHistoryEntries(await database.query.quest.findMany(), current);
    current.questData = getNewTrackers(current, [{ task: "any" }]).trackers;
    expect(current.questData.map((tracker) => tracker.id).sort()).toEqual(["loaded-arena", "omitted-level"]);
    const loaded = filterCombatQuests(current.userQuests);
    expect(loaded.map((entry) => entry.questId)).toEqual(["loaded-arena"]);
    const state = makeCompleteBattle({ id: "cache-fight", battleType: "ARENA", rewardScaling: 1, usersState: [
      makeBattleUser("cache-player", { direction: "left", rank: "NONE", level: original.level, originalLevel: original.level, isAi: false, isSummon: false, curHealth: 100, sector: 1, items: [] }),
      makeBattleUser("cache-ai", { direction: "right", isAi: true, curHealth: 0, sector: 1, leftBattle: true }),
    ], extraState: {
      profileCacheSnapshots: { "cache-player": captureCombatCacheSnapshot(original) },
      energyCapacity: { "cache-player": 100 }, energyRegeneration: { "cache-player": 0 },
      questData: { "cache-player": original.questData ?? [] }, userQuests: { "cache-player": loaded },
    } });
    const result = calcBattleResult(state, "cache-player", [])!;
    result.villagePrestige = 0; result.villageTokens = 0; result.anbuPoints = 0; result.clanPoints = 0;
    const { statements } = await recordQueries(() => updateUser(database, { trigger: async () => {} } as unknown as PusherClient, state, result, "cache-player"));
    expect(statements.some((statement) => /^select\b/i.test(statement))).toBe(false);
    expect(result.profileUpdate?.userPatch.questData?.map((tracker) => tracker.id)).toEqual(["loaded-arena"]);
    expect(combatProfilePatch(current, result.profileUpdate!)?.questData?.map((tracker) => tracker.id).sort()).toEqual(["loaded-arena", "omitted-level"]);
    expect((await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player") }))?.questData).toEqual([]);
  });

  it("withholds hidden private trackers omitted by the initiation history query", async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    const database = await getTestDatabase();
    const secret = QuestTracker.parse({ id: "hidden-map", goals: [{ id: "secret", sector: 2, longitude: 7, latitude: 8 }] });
    await database.update(userData).set({ status: "AWAKE", battleId: null, role: "USER", sector: 1, level: 1, questData: [secret] }).where(eq(userData.userId, "cache-player"));
    await insertUsers([{ userId: "private-ai", username: "Private AI", isAi: true, level: 1, rank: "NONE", inArena: true }]);
    await database.insert(aiProfile).values({ id: "Default", userId: "private-ai", rules: [] });
    await insertQuests([{ id: "hidden-map", hidden: true, questType: "achievement", maxCompletes: 100, maxAttempts: 100,
      content: { objectives: [AllObjectives.parse({ id: "secret", task: "move_to_location", sector: 2, longitude: 7, latitude: 8, sectorType: "specific", sectorList: [], locationType: "specific", hideLocation: true })], reward: ObjectiveReward.parse({}), sceneCharacters: [], sceneBackground: "" },
    }]);
    await insertQuestHistory([{ userId: "cache-player", questId: "hidden-map", questType: "achievement" }]);
    expect((await initiateBattle({ client: database, userIds: ["cache-player"], targetIds: ["private-ai"] }, "QUEST")).success).toBe(true);
    const saved = await database.query.battle.findFirst();
    if (!saved) throw new Error("Missing combat state");
    expect(saved.extraState.userQuests["cache-player"] ?? []).toEqual([]);
    expect(saved.extraState.questData["cache-player"]).toEqual([secret]);
    for (const enemy of saved.usersState.filter((user) => user.isAi)) enemy.curHealth = 0;
    const result = calcBattleResult(saved, "cache-player", [])!;
    result.villagePrestige = 0; result.villageTokens = 0; result.anbuPoints = 0; result.clanPoints = 0;
    const { statements } = await recordQueries(() => updateUser(database, { trigger: async () => {} } as unknown as PusherClient, saved, result, "cache-player"));
    expect(statements.some((statement) => /^select\b/i.test(statement))).toBe(false);
    expect(result.profileUpdate?.userPatch.questData).toEqual([]);
    expect((await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player") }))?.questData).toEqual([secret]);
  });
});
