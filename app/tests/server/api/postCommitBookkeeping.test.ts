import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import * as nextServer from "next/server";
import { MEDNIN_EXP_CAP, MEDNIN_REQUIRED_EXP } from "@/drizzle/constants";
import * as training from "@/libs/train";
import { Pusher } from "@/libs/pusher";
import { hospitalRouter } from "@/server/api/routers/hospital";
import { trainRouter } from "@/server/api/routers/train";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { resetServerModuleStubs, stubProfile } from "../../setup/serverModules";
import { callerForDatabase } from "../../setup/testDatabase";

const startedAt = new Date(Date.now() - 60_000);
const deferred: Array<() => unknown> = [];
const user = () => ({
  userId: "bookkeeping-user",
  username: "BookkeepingUser",
  updatedAt: new Date(),
  status: "AWAKE",
  rank: "JONIN",
  level: 50,
  isBanned: false,
  isOutlaw: true,
  villageId: null,
  sector: 1,
  longitude: 0,
  latitude: 0,
  curEnergy: 100,
  maxEnergy: 100,
  curHealth: 100,
  maxHealth: 1000,
  curChakra: 8000,
  maxChakra: 8000,
  curStamina: 1000,
  maxStamina: 1000,
  regeneration: 0,
  regenAt: new Date(),
  medicalExperience: MEDNIN_REQUIRED_EXP.LEGENDARY,
  offence: 10,
  trainingSpeed: "15min",
  dailyTrainings: 0,
  currentlyTrainingMastery: "ninjutsuMastery",
  masteryTrainingStartedAt: startedAt,
  ninjutsuMastery: 10,
  genjutsuMastery: 10,
  taijutsuMastery: 10,
  bukijutsuMastery: 10,
  bloodlineMastery: 10,
  sageMastery: 10,
  elementalMastery: {},
  masteryRanks: {},
  questData: [],
  userQuests: [],
}) as unknown as NonNullable<UserWithRelations>;

const database = () => {
  const where = vi.fn().mockResolvedValue({ rowsAffected: 1 });
  const set = vi.fn((_values: Record<string, unknown>) => ({ where }));
  const update = vi.fn(() => ({ set }));
  const values = vi.fn((_entry: unknown) => Promise.resolve({ rowsAffected: 1 }));
  const insert = vi.fn(() => ({ values }));
  return { update, insert, set, where, values };
};

beforeEach(() => {
  deferred.length = 0;
  stubProfile("fetchUpdatedUser", vi.fn().mockResolvedValue({
    user: user(), settings: [], requiresProgressionRefresh: true,
    publishedAchievementIds: [],
  }) as never);
  vi.spyOn(nextServer, "after").mockImplementation((callback) => {
    deferred.push(callback as () => unknown);
  });
  vi.spyOn(Sentry, "captureException").mockReturnValue("test-event");
  vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  vi.spyOn(training, "trainingBoost").mockReturnValue(1);
  vi.spyOn(training, "getTrainingMultiplierBoost").mockReturnValue(1);
  vi.spyOn(training, "calcMasteryTrainingAmount").mockReturnValue(1);
});

afterEach(() => {
  resetServerModuleStubs();
  vi.restoreAllMocks();
});

const trainingCases = [
  { name: "startTraining", invoke: (db: ReturnType<typeof database>) =>
    callerForDatabase(trainRouter, "bookkeeping-user", db as never)
      .startTraining({ stat: "offence", energy: 10 }) },
  { name: "stopMasteryTraining", invoke: (db: ReturnType<typeof database>) =>
    callerForDatabase(trainRouter, "bookkeeping-user", db as never)
      .stopMasteryTraining({ stat: "ninjutsuMastery", startedAt }) },
] as const;

describe.each(trainingCases)("$name history", ({ name, invoke }) => {
  it("responds after claiming gains without starting the history write", async () => {
    const db = database();
    let commit!: (result: { rowsAffected: number }) => void;
    let reachedClaim!: () => void;
    const claimed = new Promise<void>((resolve) => { reachedClaim = resolve; });
    const committed = new Promise<{ rowsAffected: number }>((resolve) => { commit = resolve; });
    db.where.mockImplementationOnce(() => { reachedClaim(); return committed; });
    const response = invoke(db);
    await claimed;
    expect(deferred).toHaveLength(0);
    commit({ rowsAffected: 1 });
    expect((await response).success).toBe(true);
    expect(db.insert).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(1);
    const respondedAt = Date.now();
    await deferred[0]?.();
    expect(db.values).toHaveBeenCalledTimes(1);
    expect(db.values.mock.calls[0]?.[0]).toMatchObject({ userId: "bookkeeping-user" });
    const entry = db.values.mock.calls[0]?.[0] as unknown as { trainingFinishedAt: Date };
    expect(entry.trainingFinishedAt.getTime()).toBeLessThanOrEqual(respondedAt);
  });

  it("schedules no history when the gain claim loses", async () => {
    const db = database();
    db.where.mockResolvedValue({ rowsAffected: 0 });
    expect((await invoke(db)).success).toBe(false);
    expect(deferred).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("reports a deferred history failure without rejecting committed training", async () => {
    const db = database();
    const failure = new Error("history unavailable");
    db.values.mockRejectedValue(failure);
    expect((await invoke(db)).success).toBe(true);
    await deferred[0]?.();
    expect(Sentry.captureException).toHaveBeenCalledWith(failure, {
      tags: { source: `train.${name}.trainingLog` },
    });
  });
});

describe("healing student shares", () => {
  const heal = (db: ReturnType<typeof database>) =>
    callerForDatabase(hospitalRouter, "bookkeeping-user", db as never)
      .userHeal({ userId: "bookkeeping-user", healPercentage: 100 });

  it("responds after the heal without starting the atomic student increment", async () => {
    const db = database();
    expect((await heal(db)).success).toBe(true);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(deferred).toHaveLength(1);
    await deferred[0]?.();
    expect(db.update).toHaveBeenCalledTimes(2);
    expect(db.set.mock.calls[1]?.[0]).toHaveProperty("medicalExperience");
  });

  it("schedules no share after a rejected heal", async () => {
    const db = database();
    db.where.mockResolvedValue({ rowsAffected: 0 });
    expect((await heal(db)).success).toBe(false);
    expect(deferred).toHaveLength(0);
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("skips the share when no medical experience was earned", async () => {
    stubProfile("fetchUpdatedUser", vi.fn().mockResolvedValue({
      user: { ...user(), medicalExperience: MEDNIN_EXP_CAP },
    }) as never);
    const db = database();
    expect((await heal(db)).success).toBe(true);
    expect(deferred).toHaveLength(0);
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("reports a deferred share failure without rejecting the committed heal", async () => {
    const db = database();
    const failure = new Error("share unavailable");
    db.where.mockResolvedValueOnce({ rowsAffected: 1 }).mockRejectedValueOnce(failure);
    expect((await heal(db)).success).toBe(true);
    await deferred[0]?.();
    expect(Sentry.captureException).toHaveBeenCalledWith(failure, {
      tags: { source: "hospital.userHeal.studentShare" },
    });
  });
});
