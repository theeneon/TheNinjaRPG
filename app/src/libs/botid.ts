/**
 * Vercel BotID configuration shared by the browser (`instrumentation-client.ts`) and the
 * tRPC server (`@/server/utils/botid`).
 *
 * Only the Basic check level is used: it is free on every plan, whereas Deep Analysis is
 * billed per `checkBotId()` call. The level must be identical on the client protect entry
 * and on every server call, or verification fails, so both sides read it from here. Keep
 * Deep Analysis disabled in the Vercel dashboard as well; a per-route `checkLevel` takes
 * precedence over the project setting, but nothing here relies on that.
 */
export const BOTID_CHECK_LEVEL = "basic" as const;

/**
 * Requests the BotID client attaches its challenge headers to.
 *
 * httpBatchLink sends every mutation as a POST to `/api/trpc/<path>[,<path>...]?batch=1`
 * and every query as a GET (no `methodOverride` is configured), so POST is exactly the
 * set of mutations. BotID matches the pathname only, without the query string, and `*`
 * spans any number of characters, so a batched path matches too. The CDN-cached query
 * endpoint (`/api/trpc/cdn/...`) is GET-only and never matches.
 */
export const BOTID_PROTECTED_ROUTES = [
  {
    path: "/api/trpc/*",
    method: "POST",
    advancedOptions: { checkLevel: BOTID_CHECK_LEVEL },
  },
];

/** Shown to a player whose mutation BotID classified as automated. */
export const BOTID_BLOCKED_MESSAGE =
  "Your request was blocked by our bot protection. Please reload the page and try again; contact support if this keeps happening.";
