import type { BattleUserState } from "@/libs/combat/types";
import { makeBattleUser } from "./battleScenario";

/** Shared AI actor defaults; each suite supplies its own opponents, rules and catalog. */
export const makeAiUser = (over: Partial<BattleUserState>): BattleUserState =>
  makeBattleUser(over.userId ?? "x", {
    username: "x",
    controllerId: "x",
    isAi: true,
    isSummon: false,
    isPiloted: false,
    longitude: 1,
    latitude: 1,
    effects: [],
    round: 0,
    direction: "right",
    isAggressor: false,
    highestGenerals: [],
    level: 10,
    originalLevel: 10,
    originalLongitude: 1,
    originalLatitude: 1,
    offence: 100,
    defence: 100,
    ninjutsuMastery: 100,
    genjutsuMastery: 100,
    taijutsuMastery: 100,
    bukijutsuMastery: 100,
    bloodlineMastery: 100,
    sageMastery: 100,
    strength: 100,
    intelligence: 100,
    willpower: 100,
    speed: 100,
    ...over,
  });
