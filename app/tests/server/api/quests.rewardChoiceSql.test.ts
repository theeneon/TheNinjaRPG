// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { item, quest, questHistory, userData, userItem } from "@/drizzle/schema";
import { questsRouter } from "@/server/api/routers/quests";
import type { PendingRewardChoice } from "@/validators/rewards";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUsers,
} from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

/**
 * The claim consumes the stored offer with a JSON_EXTRACT compare-and-swap. A mocked client would
 * only show that the predicate was written; these run it on MySQL to prove the engine grants once.
 */
const PLAYER = "choice-player";
const QUEST = "choice-quest";

const offer: PendingRewardChoice = {
  id: "offer-1",
  pickCount: 2,
  cards: [
    { id: "reward_money", field: "reward_money", amount: 500 },
    { id: "reward_exp", field: "reward_exp", amount: 1000 },
    { id: "reward_items:0:tanto", field: "reward_items", amount: 2, contentId: "tanto" },
  ],
};

const caller = () => callerFor(questsRouter, PLAYER);

const playerState = async () => {
  const database = await getTestDatabase();
  const [user, history, items] = await Promise.all([
    database.query.userData.findFirst({ where: eq(userData.userId, PLAYER) }),
    database.query.questHistory.findFirst({ where: eq(questHistory.userId, PLAYER) }),
    database.query.userItem.findMany({ where: eq(userItem.userId, PLAYER) }),
  ]);
  return {
    money: user?.money,
    exp: user?.earnedExperience,
    pending: history?.pendingRewardChoice ?? null,
    itemQuantity: items.reduce((sum, row) => sum + row.quantity, 0),
  };
};

describeWithDatabase("quest reward choice against a real MySQL", () => {
  beforeEach(async () => {
    await resetTables(userData, quest, questHistory, item, userItem);
    await insertUsers([
      { userId: PLAYER, username: "choiceplayer", money: 0, earnedExperience: 0 },
    ]);
    await insertQuests([{ id: QUEST, name: "Choice quest", questType: "mission" }]);
    await insertItems([
      { id: "tanto", name: "Shadow Tanto", rarity: "RARE", canStack: true, stackSize: 10 },
    ]);
    await insertQuestHistory([
      {
        userId: PLAYER,
        questId: QUEST,
        questType: "mission",
        completed: 1,
        pendingRewardChoice: offer,
      },
    ]);
  });

  it("lists the waiting offer with its content resolved for display", async () => {
    const choices = await (await caller()).getPendingRewardChoices();
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({
      questId: QUEST,
      questName: "Choice quest",
      choiceId: "offer-1",
      pickCount: 2,
    });
    expect(choices[0]?.cards.map((card) => card.name)).toEqual([
      "Ryo",
      "Experience",
      "Shadow Tanto",
    ]);
    expect(choices[0]?.cards[2]).toMatchObject({ rarity: "RARE", amount: 2 });
  });

  it("grants only the picked rewards and consumes the offer", async () => {
    const result = await (await caller()).claimRewardChoice({
      questId: QUEST,
      choiceId: "offer-1",
      cardIds: ["reward_money", "reward_items:0:tanto"],
    });
    expect(result.success).toBe(true);
    expect(await playerState()).toEqual({
      money: 500,
      exp: 0,
      pending: null,
      itemQuantity: 2,
    });
    expect(await (await caller()).getPendingRewardChoices()).toEqual([]);
  });

  it("rejects a pick of the wrong size without touching the offer", async () => {
    const result = await (await caller()).claimRewardChoice({
      questId: QUEST,
      choiceId: "offer-1",
      cardIds: ["reward_money"],
    });
    expect(result.success).toBe(false);
    expect(await playerState()).toMatchObject({ money: 0, pending: offer });
  });

  it("rejects a pick against an offer that has since been replaced", async () => {
    const result = await (await caller()).claimRewardChoice({
      questId: QUEST,
      choiceId: "stale-offer",
      cardIds: ["reward_money", "reward_exp"],
    });
    expect(result.success).toBe(false);
    expect(await playerState()).toMatchObject({ money: 0, pending: offer });
  });

  it("pays a repeated claim only once", async () => {
    const pick = {
      questId: QUEST,
      choiceId: "offer-1",
      cardIds: ["reward_money", "reward_exp"],
    };
    const first = await (await caller()).claimRewardChoice(pick);
    const second = await (await caller()).claimRewardChoice(pick);
    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(await playerState()).toMatchObject({ money: 500, exp: 1000, pending: null });
  });

  it("pays parallel claims only once", async () => {
    const pick = {
      questId: QUEST,
      choiceId: "offer-1",
      cardIds: ["reward_money", "reward_exp"],
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, async () => (await caller()).claimRewardChoice(pick)),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await playerState()).toMatchObject({ money: 500, exp: 1000, pending: null });
  });
});
