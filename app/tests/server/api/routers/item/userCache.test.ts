import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { item, userData, userItem, userQueue, userRaidBuff, userVote } from "@/drizzle/schema";
import { itemRouter } from "@/server/api/routers/item";
import { profileRouter } from "@/server/api/routers/profile";
import { HealTag, IncreaseJutsuSlots, IncreaseRegenerationTag } from "@/validators/combat";
import { MEAL_ITEM_DEFAULTS } from "@/validators/cooking";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

const userId = "consume-cache-player";
const key = [["profile", "getUser"], { type: "query" }];
describeWithDatabase("confirmed consumption profile updates", () => {
  beforeEach(async () => {
    await resetTables(userRaidBuff, userQueue, userItem, item, userVote, userData);
    await insertUsers([{ userId, username: "ConsumeCache", rank: "JONIN", primaryElement: "Fire", secondaryElement: "Water", status: "AWAKE", regeneration: 0, curHealth: 10, maxHealth: 100, curChakra: 10, maxChakra: 100, curStamina: 10, maxStamina: 100 }]);
    await insertItems([
      { id: "heal", itemType: "CONSUMABLE", target: "SELF", method: "SINGLE", destroyOnUse: true, preventBattleUsage: true, effects: [HealTag.parse({ power: 10, calculation: "static", poolsAffected: ["Health", "Chakra", "Stamina"] })] },
      { id: "slot", itemType: "CONSUMABLE", target: "SELF", method: "SINGLE", destroyOnUse: true, preventBattleUsage: true, effects: [IncreaseJutsuSlots.parse({})] },
      { id: "meal", ...MEAL_ITEM_DEFAULTS, itemType: "MEAL", mealDurationSeconds: 120, effects: [IncreaseRegenerationTag.parse({ power: 20, calculation: "static" })] },
    ]);
  });
  it.each([{ itemId: "heal", equipped: "NONE" }, { itemId: "heal", equipped: "ITEM_1" }, { itemId: "slot", equipped: "NONE" }, { itemId: "meal", equipped: "NONE" }] as const)("applies confirmed $itemId ($equipped) without a getUser fetch", async ({ itemId, equipped }) => {
    const db = await getTestDatabase();
    await insertUserItems([{ id: "carried", userId, itemId, equipped, quantity: 2 }]);
    const profile = await (await callerFor(profileRouter, userId)).getUser();
    const client = new QueryClient();
    client.setQueryData(key, profile);
    let reads = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: async () => { reads++; return profile; } });
    const stop = observer.subscribe(() => undefined);
    try {
      const revision = prepareUserUpdate(client, key);
      const result = await (await callerFor(itemRouter, userId)).consume({ userItemId: "carried", expectedQuantity: 2 });
      expect(result.success).toBe(true);
      expect(result.userPatch).toBeDefined();
      expect(result.userDelta).toEqual({});
      await updateUserCache(client, key, result.userPatch, { revision, delta: result.userDelta, achievementProgress: result.achievementProgress });
      const saved = (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))!;
      const cached = client.getQueryData<typeof profile>(key)!.userData!;
      expect(cached).toMatchObject({ curHealth: saved.curHealth, curChakra: saved.curChakra, curStamina: saved.curStamina, extraJutsuSlots: saved.extraJutsuSlots });
      if (equipped !== "NONE") expect(cached.items.find((entry) => entry.id === "carried")?.quantity).toBe(1);
      if (itemId === "meal") {
        expect(cached.raidBuffs).toEqual(await db.query.userRaidBuff.findMany());
        expect(cached.regeneration).toBe((profile.userData?.regeneration ?? 0) + 20);
      }
      expect(reads).toBe(0);
    } finally { stop(); client.clear(); }
  });
});
