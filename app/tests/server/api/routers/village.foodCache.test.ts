import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { userData, userQueue, village, villageStructure } from "@/drizzle/schema";
import { villageRouter } from "@/server/api/routers/village";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { insertUsers } from "../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

const userId = "ramen-cache-player";
const key = [["profile", "getUser"], { type: "query" }];
describeWithDatabase("confirmed ramen cache updates", () => {
  beforeEach(async () => {
    await resetTables(userQueue, villageStructure, village, userData);
    await insertUsers([{ userId, username: "RamenCache", isOutlaw: true, rank: "JONIN", primaryElement: "Fire", secondaryElement: "Water", money: 1000, status: "AWAKE", maxHealth: 625, maxChakra: 100, maxStamina: 100, curChakra: 1, curStamina: 1, regeneration: 0 }]);
  });
  it.each([624, 625, 626])("matches SQL rounding and healed pools at %s max HP without a profile refetch", async (maxHealth) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ maxHealth }).where(eq(userData.userId, userId));
    const before = (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))!;
    const client = new QueryClient();
    client.setQueryData(key, { userData: before as NonNullable<UserWithRelations> });
    let reads = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: async () => { reads++; return { userData: before }; } });
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      const revision = prepareUserUpdate(client, key);
      const response = await (await callerFor(villageRouter, userId)).buyFood({ ramen: "small" });
      expect(response.success).toBe(true);
      expect(response.userDelta).toBeDefined();
      await updateUserCache(client, key, response.userPatch, { revision, delta: response.userDelta, achievementProgress: response.achievementProgress });
      const saved = (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))!;
      const cached = client.getQueryData<{ userData: typeof before }>(key)!.userData;
      expect(cached).toMatchObject({ money: saved.money, curHealth: saved.curHealth, curStamina: saved.curStamina, curChakra: saved.curChakra, regenAt: saved.regenAt, curEnergy: saved.curEnergy });
      expect(reads).toBe(0);
    } finally { unsubscribe(); client.clear(); }
  });
});
