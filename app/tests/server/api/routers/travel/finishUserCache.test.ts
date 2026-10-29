import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { quest, questHistory, userData, userQueue, userVote } from "@/drizzle/schema";
import { globalTravelFinishPatch } from "@/libs/travel";
import { Pusher } from "@/libs/pusher";
import { profileRouter } from "@/server/api/routers/profile";
import { travelRouter } from "@/server/api/routers/travel";
import { AllObjectives, QuestTracker } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { insertQuestHistory, insertQuests, insertUsers } from "../../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

const userId = "arrival-cache-player";
const key = [["profile", "getUser"], { type: "query" }];
describeWithDatabase("confirmed arrival profile updates", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(userQueue, userVote, questHistory, quest, userData);
    await insertUsers([{ userId, username: "ArrivalCache", rank: "JONIN", primaryElement: "Fire", secondaryElement: "Water", level: 50, isOutlaw: true, status: "TRAVEL", sector: 1, longitude: 4, latitude: 5, regeneration: 0, travelFinishAt: new Date(Date.now() + 60000) }]);
    await insertQuests([2, 3].map((sector) => ({ id: `hidden-${sector}`, name: `Hidden ${sector}`, questType: "story", maxCompletes: 10, content: {
      objectives: [AllObjectives.parse({ id: "target", task: "move_to_location", sector, longitude: 4, latitude: 5, sectorType: "specific", sectorList: [], locationType: "specific", hideLocation: true })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } })));
    await insertQuestHistory([2, 3].map((sector) => ({ userId, questId: `hidden-${sector}`, questType: "story" })));
    await (await getTestDatabase()).update(userData).set({ questData: [2, 3].map((sector) => QuestTracker.parse({ id: `hidden-${sector}`, goals: [{ id: "target", sector, longitude: 4, latitude: 5, locationChecked: true }] })) }).where(eq(userData.userId, userId));
  });
  afterEach(() => vi.restoreAllMocks());

  it("reveals only arrival targets, persists progress and avoids a full profile read or cache refetch", async () => {
    const db = await getTestDatabase();
    const profile = await (await callerFor(profileRouter, userId)).getUser();
    expect(profile.userData?.questData?.find((tracker) => tracker.id === "hidden-2")?.goals[0]?.sector).toBeUndefined();
    profile.userData!.questData!.push(QuestTracker.parse({ id: "cached-achievement", goals: [{ id: "progress", value: 7 }] }));
    const raw = (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))!;
    await db.update(userData).set({ sector: 2, travelFinishAt: new Date(Date.now() - 1), questData: [...(raw.questData ?? []), QuestTracker.parse({ id: "unloaded-private", goals: [{ id: "secret", sector: 4, longitude: 8, latitude: 9 }] })] }).where(eq(userData.userId, userId));
    const client = new QueryClient();
    client.setQueryData(key, { ...profile, userData: { ...profile.userData!, sector: 2 } });
    let reads = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: async () => { reads++; return profile; } });
    const stop = observer.subscribe(() => undefined);
    const userReads = vi.spyOn(db.query.userData, "findFirst");
    try {
      const revision = prepareUserUpdate(client, key);
      const result = await (await callerFor(travelRouter, userId)).finishGlobalMove();
      expect(result.success).toBe(true);
      expect(result.userDelta).toEqual({});
      expect(result.userPatch?.questData?.find((tracker) => tracker.id === "hidden-2")?.goals[0]).toMatchObject({ sector: 2, done: true });
      expect(result.userPatch?.questData?.find((tracker) => tracker.id === "hidden-3")?.goals[0]?.sector).toBeUndefined();
      expect(result.userPatch?.questData?.some((tracker) => tracker.id === "unloaded-private")).toBe(false);
      expect(userReads.mock.calls.some(([options]) => options?.with && "votes" in options.with)).toBe(false);
      await updateUserCache(client, key, (current) => globalTravelFinishPatch(current, result.userPatch!, result.projectedQuestIds), { revision, delta: result.userDelta });
      expect(client.getQueryData<typeof profile>(key)?.userData).toMatchObject({ status: "AWAKE", travelFinishAt: null });
      const stored = (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))!;
      expect(stored.questData?.find((tracker) => tracker.id === "hidden-2")?.goals[0]?.done).toBe(true);
      expect(stored.questData?.find((tracker) => tracker.id === "hidden-3")?.goals[0]?.sector).toBe(3);
      expect(stored.questData?.find((tracker) => tracker.id === "unloaded-private")?.goals[0]?.sector).toBe(4);
      expect(client.getQueryData<typeof profile>(key)?.userData?.questData?.find((tracker) => tracker.id === "cached-achievement")?.goals[0]?.value).toBe(7);
      expect(reads).toBe(0);
    } finally { stop(); client.clear(); }
  });
});
