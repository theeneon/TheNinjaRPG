import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "bun:test";
import { SELF_GUARDED_PYRAMID_PROCEDURES, ISOLATED_PYRAMID_MESSAGE, isPyramidRestrictedProcedure } from "@/libs/questRun";
import { combatRouter } from "@/server/api/routers/combat";
import { homeRouter } from "@/server/api/routers/home";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import { travelRouter } from "@/server/api/routers/travel";
import type { DrizzleClient } from "@/server/db";
import { resetServerModuleStubs } from "../../setup/serverModules";
import { callerForDatabase } from "../../setup/testDatabase";

const source = (path: string) => readFileSync(join(import.meta.dirname, "../../../src", path), "utf8");
const procedureSource = (router: string, name: string) => {
  const file = source(`server/api/routers/${router}.ts`);
  const start = file.indexOf(`\n  ${name}: protectedProcedure`);
  expect(start).toBeGreaterThan(-1);
  const body = file.slice(start + 1);
  const end = body.search(/\n  \w+: protectedProcedure/);
  return end === -1 ? body : body.slice(0, end);
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
let identity = 0;
const caller = <Context, Caller>(router: { createCaller: (context: Context) => Caller }, db: object) =>
  callerForDatabase(router, `preflight-${++identity}`, db as DrizzleClient);

afterEach(() => { vi.restoreAllMocks(); resetServerModuleStubs(); });

describe("self-guarded Pyramid mutations", () => {
  it("requires every middleware exemption to guard before side effects", () => {
    for (const path of SELF_GUARDED_PYRAMID_PROCEDURES) {
      expect(isPyramidRestrictedProcedure(path)).toBe(false);
      const [router, name] = path.split(".") as [string, string];
      const body = procedureSource(router, name);
      if (path === "travel.moveInSector") {
        const openingBatch = body.slice(body.indexOf("await Promise.all(["), body.indexOf("])", body.indexOf("await Promise.all([")));
        expect(openingBatch).toContain("fetchIsolatedPyramid(ctx.drizzle, userId)");
        expect(body).toContain("if (isolated) return errorResponse(ISOLATED_PYRAMID_MESSAGE)");
        expect(body.indexOf("if (isolated)")).toBeLessThan(body.indexOf("hasEnergyQueue("));
      } else {
        expect(body).toContain("rejectIsolatedPyramid: true");
        expect(body).toContain("if (isPyramidIsolated)");
        expect(body).toContain("errorResponse(ISOLATED_PYRAMID_MESSAGE)");
      }
    }
    const profile = source("server/api/routers/profile.ts");
    expect(profile.indexOf("props.rejectIsolatedPyramid && getIsolatedPyramid(fetchedUser)")).toBeLessThan(profile.indexOf("await settleDueTimedQueues("));
    const combat = procedureSource("combat", "performAction");
    expect(combat).toContain(".use(deferredRatelimitMiddleware)");
    expect(combat).toContain("isFirstAttempt ? ctx.waitForRateLimit() : undefined");
    expect(combat.indexOf("ctx.waitForRateLimit()")).toBeLessThan(combat.indexOf("advanceEncounterWave("));
    expect(procedureSource("quests", "checkLocationQuest")).toContain("canRecoverStaleMergeClaims: async () =>");
  });

  it("rejects travel before refreshing queued jobs or writing the position", async () => {
    const write = vi.fn(() => { throw new Error("Unexpected write"); });
    const db = { query: {
      questHistory: { findFirst: async () => ({ id: "hidden-run" }) },
      userData: { findFirst: async () => ({ queue: [{ kind: "TRAINING" }] }) },
      sector: { findMany: async () => [] },
    }, update: write };
    const api = caller(travelRouter, db);
    const response = await api.moveInSector({ curLongitude: 0, curLatitude: 0, longitude: 1, latitude: 0, sector: 0, level: 50, avatar: "https://example.com/avatar.png", avatarLight: "https://example.com/avatar.png", username: "hero" });
    expect(response).toEqual({ success: false, message: ISOLATED_PYRAMID_MESSAGE });
    expect(write).not.toHaveBeenCalled();
  });

  it.each(["home", "quests"])("rejects %s from the loaded history before profile settlement", async (router) => {
    const write = vi.fn(() => { throw new Error("Unexpected profile write"); });
    // All catalogue/settings/war queries are reads; the profile snapshot contains an
    // isolated run with a hidden definition and no client tracker to reveal it.
    const emptyRows = () => {
      const rows = Promise.resolve([]);
      return Object.assign(rows, { from: () => rows, where: () => rows, leftJoin: () => rows, innerJoin: () => rows, limit: () => rows });
    };
    const snapshot = { userQuests: [{ isolated: true, completed: 0, endAt: null, quest: { hidden: true } }], queue: [{ kind: "TRAINING", position: 0 }], questData: [], votes: null };
    const db = { select: emptyRows, query: {
      userData: { findFirst: async () => snapshot },
      war: { findMany: async () => [] },
      mpvpBattleQueue: { findMany: async () => [] },
      quest: { findMany: async () => [] },
      userItem: { findMany: async () => [{ quantity: -1, updatedAt: new Date(0) }] },
    }, insert: write, update: write, delete: write };
    const result = router === "home"
      ? await caller(homeRouter, db).toggleSleep()
      : await caller(questsRouter, db).checkLocationQuest();
    expect(result).toMatchObject({ success: false, message: ISOLATED_PYRAMID_MESSAGE });
    expect(write).not.toHaveBeenCalled();
    const refreshed = await fetchUpdatedUser({ client: db as unknown as DrizzleClient, userId: "isolated", rejectIsolatedPyramid: true });
    expect(refreshed.isPyramidIsolated).toBe(true);
    expect(refreshed.user).toBeUndefined();
  });
});

describe("combat deferred rate limit", () => {
  const mockLimiter = (answer: () => Promise<number[] | { error: string }>) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (typeof init?.body !== "string" || !init.body.includes("trpc-ratelimit")) throw new Error("Unexpected HTTP request");
      const commands = JSON.parse(init.body) as unknown[][];
      const response = async (command: unknown[]) => {
        if (command[0] !== "evalsha" && command[0] !== "eval") return { result: 1 };
        const result = await answer();
        return Array.isArray(result) ? { result } : result;
      };
      return Response.json(Array.isArray(commands[0]) ? await Promise.all(commands.map(response)) : await response(commands));
    });
  };

  it("starts the first battle read while Redis is pending and awaits both", async () => {
    const limiter = deferred<number[]>();
    const limiterStarted = deferred<void>();
    const battleStarted = deferred<void>();
    mockLimiter(() => { limiterStarted.resolve(); return limiter.promise; });
    const read = vi.fn(async () => { battleStarted.resolve(); return undefined; });
    let finished = false;
    const result = caller(combatRouter, { query: { battle: { findFirst: read } } }).performAction({ battleId: "missing", version: 0 }).then((value) => { finished = true; return value; });
    await Promise.all([limiterStarted.promise, battleStarted.promise]);
    expect(finished).toBe(false);
    limiter.resolve([59, 60]);
    expect(await result).toEqual({ updateClient: true });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each([1, 0])("preserves a single denial penalty with rowsAffected=%i", async (rowsAffected) => {
    mockLimiter(async () => [-1, 60]);
    const penalty = vi.fn(async () => ({ rowsAffected }));
    const update = vi.fn(() => ({ set: () => ({ where: penalty }) }));
    // Any processing of this sentinel would throw; rate limiting must finish first.
    const api = caller(combatRouter, { query: { battle: { findFirst: async () => ({}) } }, update });
    await expect(api.performAction({ battleId: "battle", version: 0 })).rejects.toMatchObject({ code: rowsAffected ? "TOO_MANY_REQUESTS" : "NOT_FOUND" });
    expect(update).toHaveBeenCalledTimes(1);
    expect(penalty).toHaveBeenCalledTimes(1);
  });

  it("observes a limiter failure even if the first battle read rejects", async () => {
    mockLimiter(async () => ({ error: "ERR limiter unavailable" }));
    const api = caller(combatRouter, { query: { battle: { findFirst: async () => { throw new Error("battle read failed"); } } } });
    await expect(api.performAction({ battleId: "battle", version: 0 })).rejects.toThrow("limiter unavailable");
  });

  it("keeps limiter rejection ahead of input validation without a battle read", async () => {
    mockLimiter(async () => [-1, 60]);
    const read = vi.fn(async () => undefined);
    const penalty = vi.fn(async () => ({ rowsAffected: 1 }));
    const api = caller(combatRouter, { query: { battle: { findFirst: read } }, update: () => ({ set: () => ({ where: penalty }) }) });
    await expect(api.performAction({ battleId: 42 } as never)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(read).not.toHaveBeenCalled();
    expect(penalty).toHaveBeenCalledTimes(1);
  });
});
