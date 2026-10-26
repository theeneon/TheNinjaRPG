import { describe, expect, it } from "bun:test";
import {
  CLAN_BOOST_MAX_LEVEL,
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CRAFTING_TIMES_MINS,
  FARM_GOLD_FED_TIME_REDUCTION_PERCENT,
} from "@/drizzle/constants";
import { getCookingSeconds } from "@/libs/cooking";
import { getCraftingSeconds } from "@/libs/crafting";
import {
  applyFertilizerReduction,
  applyWaterReduction,
  getFarmGrowTimeSeconds,
} from "@/libs/farming";
import { reduceActivitySeconds } from "@/utils/time";

describe("percentage activity duration rules", () => {
  it("reduces by percentage, stacks additively and clamps to one second", () => {
    expect(reduceActivitySeconds(60, 10)).toBe(54);
    expect(reduceActivitySeconds(60, 10 + 15)).toBe(45);
    expect(reduceActivitySeconds(8, 100)).toBe(1);
    expect(reduceActivitySeconds(60, 150)).toBe(1);
    expect(reduceActivitySeconds(60, 12.5)).toBe(53);
    expect(reduceActivitySeconds(18.06, 0)).toBe(18.06);
  });
  it("applies farming reduction after Federal rounding, independently per crop", () => {
    const player = { staffAccount: false, federalStatus: "GOLD" as const };
    const original = Math.max(
      1,
      Math.ceil(61 * (1 - FARM_GOLD_FED_TIME_REDUCTION_PERCENT / 100)),
    );
    expect(getFarmGrowTimeSeconds(61, player)).toBe(original);
    expect(getFarmGrowTimeSeconds(61, player, 10)).toBe(Math.ceil(original * 0.9));
    expect(
      Array.from({ length: 5 }, () => getFarmGrowTimeSeconds(61, player, 10)),
    ).toEqual(Array(5).fill(Math.ceil(original * 0.9)));
    expect(getFarmGrowTimeSeconds(8, player, 100)).toBe(1);
  });
  it("keeps later fertilizer and watering reductions on the saved deadline", () => {
    const now = new Date(0);
    expect(applyFertilizerReduction(new Date(50_000), 10, now)).toEqual(
      new Date(40_000),
    );
    expect(applyWaterReduction(new Date(1000), now)).toEqual(now);
  });
  it("reduces once after complete crafting quantities, shrine and clan factors", () => {
    const item = { itemType: "ARMOR" as const, rarity: "COMMON" as const };
    const original = Math.round(CRAFTING_TIMES_MINS.NOVICE.COMMON * 60 * 0.9 * 0.8 * 5);
    const clanCap = CLAN_BOOST_MAX_LEVEL * CLAN_BOOST_PERCENT_PER_LEVEL;
    expect(getCraftingSeconds(item, "NOVICE", 5, 0.1, clanCap)).toBe(original);
    expect(getCraftingSeconds(item, "NOVICE", 5, 0.1, clanCap, 10)).toBe(
      Math.ceil(original * 0.9),
    );
    expect(getCraftingSeconds(item, "NOVICE", 5, 0.1, clanCap, original + 10)).toBe(1);
  });
  it("keeps cooking shrine increases and reduces once after outputs and batches", () => {
    const meal = { cookingTimeSeconds: 60, cookingOutputQuantity: 3 };
    expect(getCookingSeconds(meal, 5, 0.1)).toBe(990);
    expect(getCookingSeconds(meal, 5, 0.1, 0, 10)).toBe(891);
    expect(getCookingSeconds(meal, 5, 0.1, 0, 1000)).toBe(1);
  });
  it("combines Territory War boosts with percentage crafting and cooking reductions", () => {
    const item = { itemType: "ARMOR" as const, rarity: "COMMON" as const };
    const clanCap = CLAN_BOOST_MAX_LEVEL * CLAN_BOOST_PERCENT_PER_LEVEL;
    const craftingSeconds = Math.round(
      CRAFTING_TIMES_MINS.NOVICE.COMMON * 60 * 0.9 * 0.8 * 5 * 0.85,
    );
    expect(getCraftingSeconds(item, "NOVICE", 5, 0.1, clanCap, 10, 0.15)).toBe(
      Math.ceil(craftingSeconds * 0.9),
    );
    const meal = { cookingTimeSeconds: 60, cookingOutputQuantity: 3 };
    expect(getCookingSeconds(meal, 5, 0.1, 0.15, 10)).toBe(758);
    expect(getCookingSeconds(meal, 5, 0.1, 0.15, 1000)).toBe(1);
  });
});
