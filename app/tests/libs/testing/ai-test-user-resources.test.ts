import { describe, expect, it } from "bun:test";
import { FARM_MAX_PLOTS, FARM_STARTING_PLOTS } from "@/drizzle/constants";
import { testUserResourceValues } from "@/libs/testing/ai-test-users";
import { aiTestUserProfileSchema } from "@/validators/ai-test-user";
const profile = { key: "hero", level: 50, rank: "JONIN", villageName: "Akikaze" };

describe("test-user gameplay resources", () => {
  it("keeps an ordinary provisioning request unchanged", () => {
    expect(testUserResourceValues(undefined)).toEqual({});
    expect(aiTestUserProfileSchema.parse(profile).resources).toBeUndefined();
  });
  it("prepares full current pools together with the requested maxima", () => {
    const resources = aiTestUserProfileSchema.parse({ ...profile, resources: { maxHealth: 10000, maxChakra: 2000, maxStamina: 3000, farmCurrency: 10000, towerDefensePoints: 1000 } }).resources;
    expect(testUserResourceValues(resources)).toEqual({ ...resources, curHealth: 10000, curChakra: 2000, curStamina: 3000 });
    expect(testUserResourceValues({ farmCurrency: 10 })).toEqual({ farmCurrency: 10 });
  });
  it("bounds plots and rejects arbitrary or transferable economy fields", () => {
    expect(aiTestUserProfileSchema.safeParse({ ...profile, resources: { farmPlotsPurchased: FARM_MAX_PLOTS - FARM_STARTING_PLOTS } }).success).toBe(true);
    for (const resources of [{ money: 1000 }, { seichiSilver: 10 }, { farmPlotsPurchased: FARM_MAX_PLOTS }, { maxHealth: 0 }, { maxStamina: 1_000_001 }, { farmCurrency: -1 }]) expect(aiTestUserProfileSchema.safeParse({ ...profile, resources }).success).toBe(false);
  });
});
