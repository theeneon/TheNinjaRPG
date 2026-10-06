import { AsyncLocalStorage } from "node:async_hooks";
import * as Sentry from "@sentry/node";
import { TRPCError } from "@trpc/server";
import { checkBotId } from "botid/server";
import { env } from "@/env/server.mjs";
import { BOTID_BLOCKED_MESSAGE, BOTID_CHECK_LEVEL } from "@/libs/botid";

/**
 * Vercel BotID for tRPC mutations.
 *
 * The /api/trpc route opens a guard for every POST it serves on Vercel; the tRPC
 * middleware awaits it before any mutation runs. A guard calls `checkBotId()` at most once,
 * however many mutations the batch carries, and is only reachable through the route, so
 * server-side callers (`createCaller` from MCP, the AI test-user broker, the content
 * review desk, tests and scripts) never see BotID at all.
 *
 * A classification is never allowed to break gameplay on its own: an error or timeout
 * from BotID lets the request through, and blocking is limited to production by default
 * (see `isBotIdEnforced`).
 */

/**
 * Upper bound on the BotID round trip. In production `checkBotId()` POSTs to
 * api.vercel.com, and every mutation waits for it, so a slow answer is treated as no
 * answer.
 */
export const BOTID_TIMEOUT_MS = 1500;

export type BotIdVerdict =
  | {
      ok: true;
      isBot: boolean;
      isHuman: boolean;
      isVerifiedBot: boolean;
      verifiedBotName: string | undefined;
      bypassed: boolean;
    }
  | { ok: false; reason: string };

export type BotIdGuard = {
  /** Procedure paths named by the request URL, for the record of a detection. */
  paths: string[];
  /** The memoized verdict for this HTTP request. */
  verify: () => Promise<BotIdVerdict>;
  /** Whether this request's outcome has been recorded, so a batch records it once. */
  reported: boolean;
  /** Whether a Sentry event was captured that the route must flush. */
  needsFlush: boolean;
};

const storage = new AsyncLocalStorage<BotIdGuard>();

/** Ask BotID about the current request; resolves to a failed verdict instead of throwing. */
export const runBotIdCheck = async (
  timeoutMs: number = BOTID_TIMEOUT_MS,
): Promise<BotIdVerdict> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`checkBotId timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    const result = await Promise.race([
      checkBotId({ advancedOptions: { checkLevel: BOTID_CHECK_LEVEL } }),
      timeout,
    ]);
    return {
      ok: true,
      isBot: result.isBot,
      isHuman: result.isHuman,
      isVerifiedBot: result.isVerifiedBot,
      verifiedBotName: "verifiedBotName" in result ? result.verifiedBotName : undefined,
      bypassed: result.bypassed,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

/** A per-request guard whose check runs at most once. */
export const createBotIdGuard = (
  paths: string[],
  check: () => Promise<BotIdVerdict> = runBotIdCheck,
): BotIdGuard => {
  let pending: Promise<BotIdVerdict> | undefined;
  return {
    paths,
    verify: () => {
      pending ??= check();
      return pending;
    },
    reported: false,
    needsFlush: false,
  };
};

/** Run `fn` with `guard` visible to the tRPC middleware; without one, `fn` runs unguarded. */
export const withBotIdGuard = <T>(guard: BotIdGuard | undefined, fn: () => T): T =>
  guard ? storage.run(guard, fn) : fn();

/**
 * Whether a request to /api/trpc gets a guard: mutations (always POST from httpBatchLink)
 * on a Vercel deployment. Elsewhere BotID has nothing to classify with: `next dev` answers
 * "human" for every request, and a production build outside Vercel has no OIDC token.
 */
export const shouldGuardTrpcRequest = (
  method: string,
  isOnVercel: boolean = process.env.VERCEL === "1",
) => method === "POST" && isOnVercel;

/** `/api/trpc/a.b,c.d?batch=1` → `["a.b", "c.d"]`. */
export const trpcPathsFromUrl = (url: string): string[] => {
  const pathname = new URL(url, "http://localhost").pathname;
  const joined = pathname.replace(/^\/api\/trpc\/?/, "");
  try {
    return decodeURIComponent(joined).split(",").filter(Boolean);
  } catch {
    return [joined];
  }
};

/**
 * Whether a bot verdict blocks the mutation. `BOTID_ENFORCE=false` is the kill switch
 * (record only); `true` also enforces on preview deployments; unset enforces on the
 * production deployment only, so headless reviewer and audit runs against previews are
 * recorded but never blocked.
 */
export const isBotIdEnforced = (
  {
    setting,
    vercelEnv,
  }: {
    setting: "true" | "false" | undefined;
    vercelEnv: string | undefined;
  } = { setting: env.BOTID_ENFORCE, vercelEnv: process.env.VERCEL_ENV },
) => setting === "true" || (setting !== "false" && vercelEnv === "production");

/**
 * Called by the tRPC middleware before every procedure. Mutations inside a guarded
 * request wait for the verdict and are rejected with FORBIDDEN when BotID classifies the
 * request as a bot and enforcement is on. Anything else passes.
 */
export const enforceBotId = async (props: {
  type: string;
  path: string;
  userId: string | null | undefined;
}) => {
  if (props.type !== "mutation") return;
  const guard = storage.getStore();
  if (!guard) return;
  const verdict = await guard.verify();
  if (verdict.ok && !verdict.isBot) return;
  const enforced = verdict.ok && isBotIdEnforced();
  if (!guard.reported) {
    guard.reported = true;
    recordBotIdOutcome(guard, verdict, { ...props, enforced });
  }
  if (enforced) {
    throw new TRPCError({ code: "FORBIDDEN", message: BOTID_BLOCKED_MESSAGE });
  }
};

const recordBotIdOutcome = (
  guard: BotIdGuard,
  verdict: BotIdVerdict,
  details: { path: string; userId: string | null | undefined; enforced: boolean },
) => {
  const base = {
    userId: details.userId ?? null,
    path: details.path,
    paths: guard.paths,
    checkLevel: BOTID_CHECK_LEVEL,
  };
  if (!verdict.ok) {
    // Logged only: a BotID outage would otherwise raise a Sentry event per mutation.
    console.warn(
      `[botid] ${JSON.stringify({ event: "check_failed", ...base, reason: verdict.reason })}`,
    );
    Sentry.addBreadcrumb({
      category: "botid",
      level: "warning",
      message: "BotID check failed; request allowed",
      data: { ...base, reason: verdict.reason },
    });
    return;
  }
  const action = details.enforced ? "blocked" : "observed";
  const record = {
    event: action,
    ...base,
    isBot: verdict.isBot,
    isHuman: verdict.isHuman,
    isVerifiedBot: verdict.isVerifiedBot,
    verifiedBotName: verdict.verifiedBotName ?? null,
    bypassed: verdict.bypassed,
  };
  console.warn(`[botid] ${JSON.stringify(record)}`);
  Sentry.addBreadcrumb({
    category: "botid",
    level: "warning",
    message: action,
    data: record,
  });
  Sentry.captureMessage(`BotID ${action} a tRPC mutation`, {
    level: "warning",
    fingerprint: ["botid", action],
    tags: { botid: action, botid_verified_bot: String(verdict.isVerifiedBot) },
    user: details.userId ? { id: details.userId } : undefined,
    extra: record,
  });
  guard.needsFlush = true;
};
