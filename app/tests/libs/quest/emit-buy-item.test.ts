import {
  trackerQuest as makeQuest,
  trackerUser as makeUser,
  trackerGoalValue as goalValue,
} from "../../setup/quest";
import { describe, expect, it } from "bun:test";
import { getNewTrackers } from "@/libs/quest";

const buyItemObjective = (id: string, ids: string[], value = 5) => ({
  id,
  task: "buy_item" as const,
  value,
  buyItemIds: ids,
  description: "",
  successDescription: "",
});

describe("buy_item emit", () => {
  it("increments by the purchased stack size for a listed item", () => {
    const quest = makeQuest("q", [buyItemObjective("o", ["itemA"], 5)]);
    // input.stack === 3, input.itemId === "itemA"
    const result = getNewTrackers(makeUser([quest]), [
      { task: "buy_item", increment: 3, contentId: "itemA" },
    ]);
    expect(goalValue(result, "q", "o")).toBe(3);
  });

  it("credits two buy_item objectives independently by their id-lists", () => {
    const quest = makeQuest("q", [
      buyItemObjective("o-a", ["itemA"], 5),
      buyItemObjective("o-b", ["itemB"], 5),
    ]);
    const result = getNewTrackers(makeUser([quest]), [
      { task: "buy_item", increment: 2, contentId: "itemA" },
    ]);
    expect(goalValue(result, "q", "o-a")).toBe(2);
    expect(goalValue(result, "q", "o-b")).toBe(0);
  });
});
