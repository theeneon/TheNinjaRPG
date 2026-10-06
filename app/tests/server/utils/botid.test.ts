import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/env/server.mjs";
import { BOTID_BLOCKED_MESSAGE, BOTID_PROTECTED_ROUTES } from "@/libs/botid";

// Bun shares module mocks across test files, so the mock lives on globalThis.
const getCheckBotId = () => {
  const globals = globalThis as typeof globalThis & {
    __botIdCheckMock?: ReturnType<typeof vi.fn>;
  };
  globals.__botIdCheckMock ??= vi.fn();
  return globals.__botIdCheckMock;
};
const checkBotId = getCheckBotId();

vi.mock("botid/server", () => ({ checkBotId: getCheckBotId() }));

import {
  createBotIdGuard,
  enforceBotId,
  isBotIdEnforced,
  runBotIdCheck,
  shouldGuardTrpcRequest,
  trpcPathsFromUrl,
  withBotIdGuard,
} from "@/server/utils/botid";

const human = { isHuman: true, isBot: false, isVerifiedBot: false, bypassed: false };
const bot = { isHuman: false, isBot: true, isVerifiedBot: false, bypassed: false };

const mutation = { type: "mutation", path: "train.startTraining", userId: "user-1" };

/** Run one mutation's middleware inside a fresh guarded request. */
const guardedMutation = (verdict: object) => {
  checkBotId.mockResolvedValue(verdict);
  const guard = createBotIdGuard(["train.startTraining"]);
  return { guard, run: () => withBotIdGuard(guard, () => enforceBotId(mutation)) };
};

const originalSetting = env.BOTID_ENFORCE;
const originalVercelEnv = process.env.VERCEL_ENV;
let warn: { mock: { calls: unknown[][] }; mockRestore: () => void };

/** The structured `[botid]` records logged so far. */
const records = () =>
  warn.mock.calls
    .map(([line]: unknown[]) => String(line))
    .filter((line: string) => line.startsWith("[botid] "))
    .map((line: string) => JSON.parse(line.slice("[botid] ".length)) as Record<string, unknown>);

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  env.BOTID_ENFORCE = undefined;
  process.env.VERCEL_ENV = "production";
});

afterEach(() => {
  warn.mockRestore();
  checkBotId.mockReset();
  env.BOTID_ENFORCE = originalSetting;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

describe("BotID check level", () => {
  it("asks for Basic on the client protect entry and on the server check alike", async () => {
    expect(BOTID_PROTECTED_ROUTES).toEqual([
      { path: "/api/trpc/*", method: "POST", advancedOptions: { checkLevel: "basic" } },
    ]);
    checkBotId.mockResolvedValue(human);
    await runBotIdCheck();
    expect(checkBotId).toHaveBeenCalledWith({
      advancedOptions: { checkLevel: "basic" },
    });
  });
});

describe("runBotIdCheck", () => {
  it("returns the BotID fields", async () => {
    checkBotId.mockResolvedValue({
      ...bot,
      isVerifiedBot: true,
      verifiedBotName: "googlebot",
    });
    expect(await runBotIdCheck()).toEqual({
      ok: true,
      ...bot,
      isVerifiedBot: true,
      verifiedBotName: "googlebot",
    });
  });

  it("resolves to a failed verdict when BotID throws", async () => {
    checkBotId.mockRejectedValue(new Error("VERCEL_OIDC_TOKEN is not set"));
    expect(await runBotIdCheck()).toEqual({
      ok: false,
      reason: "VERCEL_OIDC_TOKEN is not set",
    });
  });

  it("resolves to a failed verdict when BotID does not answer in time", async () => {
    checkBotId.mockReturnValue(new Promise(() => undefined));
    expect(await runBotIdCheck(20)).toEqual({
      ok: false,
      reason: "checkBotId timed out after 20ms",
    });
  });
});

describe("createBotIdGuard", () => {
  it("checks once per request, however many procedures ask", async () => {
    checkBotId.mockResolvedValue(human);
    const guard = createBotIdGuard(["a.b", "c.d"]);
    await Promise.all([guard.verify(), guard.verify(), guard.verify()]);
    expect(checkBotId).toHaveBeenCalledTimes(1);
  });
});

describe("enforceBotId", () => {
  it("lets a human through without recording anything", async () => {
    const { guard, run } = guardedMutation(human);
    await expect(run()).resolves.toBeUndefined();
    expect(records()).toEqual([]);
    expect(guard.needsFlush).toBe(false);
  });

  it("blocks a bot in production by default and records the verdict", async () => {
    const { guard, run } = guardedMutation(bot);
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({ code: "FORBIDDEN", message: BOTID_BLOCKED_MESSAGE });
    expect(records()).toEqual([
      {
        event: "blocked",
        userId: "user-1",
        path: "train.startTraining",
        paths: ["train.startTraining"],
        checkLevel: "basic",
        isBot: true,
        isHuman: false,
        isVerifiedBot: false,
        verifiedBotName: null,
        bypassed: false,
      },
    ]);
    // A Sentry event was captured, which the route flushes.
    expect(guard.needsFlush).toBe(true);
  });

  it("only records a bot when the kill switch is set", async () => {
    env.BOTID_ENFORCE = "false";
    const { guard, run } = guardedMutation(bot);
    await expect(run()).resolves.toBeUndefined();
    expect(records()).toMatchObject([{ event: "observed", isBot: true }]);
    expect(guard.needsFlush).toBe(true);
  });

  it("only records a bot on a preview deployment unless enforcement is forced", async () => {
    process.env.VERCEL_ENV = "preview";
    await expect(guardedMutation(bot).run()).resolves.toBeUndefined();
    env.BOTID_ENFORCE = "true";
    await expect(guardedMutation(bot).run()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails open when BotID errors, logging without a Sentry event", async () => {
    checkBotId.mockRejectedValue(new Error("fetch failed"));
    const guard = createBotIdGuard(["train.startTraining"]);
    await expect(
      withBotIdGuard(guard, () => enforceBotId(mutation)),
    ).resolves.toBeUndefined();
    expect(records()).toMatchObject([{ event: "check_failed", reason: "fetch failed" }]);
    expect(guard.needsFlush).toBe(false);
  });

  it("checks and records a batch once while rejecting each of its mutations", async () => {
    checkBotId.mockResolvedValue(bot);
    const guard = createBotIdGuard(["a.b", "c.d"]);
    const results = await withBotIdGuard(guard, () =>
      Promise.allSettled([
        enforceBotId({ ...mutation, path: "a.b" }),
        enforceBotId({ ...mutation, path: "c.d" }),
      ]),
    );
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(checkBotId).toHaveBeenCalledTimes(1);
    expect(records()).toHaveLength(1);
  });

  it("ignores queries", async () => {
    checkBotId.mockResolvedValue(bot);
    const guard = createBotIdGuard([]);
    await withBotIdGuard(guard, () => enforceBotId({ ...mutation, type: "query" }));
    expect(checkBotId).not.toHaveBeenCalled();
  });

  it("ignores server-side callers, which run outside a guarded request", async () => {
    checkBotId.mockResolvedValue(bot);
    await expect(enforceBotId(mutation)).resolves.toBeUndefined();
    expect(checkBotId).not.toHaveBeenCalled();
  });
});

describe("isBotIdEnforced", () => {
  it.each([
    [undefined, "production", true],
    [undefined, "preview", false],
    [undefined, undefined, false],
    ["false", "production", false],
    ["true", "preview", true],
  ] as const)("BOTID_ENFORCE=%s on %s → %s", (setting, vercelEnv, expected) => {
    expect(isBotIdEnforced({ setting, vercelEnv })).toBe(expected);
  });
});

describe("shouldGuardTrpcRequest", () => {
  it("guards mutations (POST) on Vercel only", () => {
    expect(shouldGuardTrpcRequest("POST", true)).toBe(true);
    expect(shouldGuardTrpcRequest("GET", true)).toBe(false);
    expect(shouldGuardTrpcRequest("POST", false)).toBe(false);
  });
});

describe("trpcPathsFromUrl", () => {
  it("lists every procedure of a batched request", () => {
    expect(
      trpcPathsFromUrl("https://www.theninja-rpg.com/api/trpc/a.b%2Cc.d?batch=1"),
    ).toEqual(["a.b", "c.d"]);
    expect(trpcPathsFromUrl("https://x.test/api/trpc/a.b,c.d?batch=1")).toEqual([
      "a.b",
      "c.d",
    ]);
  });
});
