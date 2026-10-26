/**
 * Deploy skew between a long-lived tab and the server.
 *
 * Tabs, especially suspended mobile tabs, keep running the bundle they loaded for days,
 * while every tRPC response comes from the current deploy. When a deploy adds a value the
 * old bundle cannot represent (a new enum member looked up in a constants table, say),
 * the old bundle crashes on the new data. Each `/api/trpc` response therefore names the
 * build that served it; once that differs from the bundle's own build, a render crash
 * reloads the page onto the current bundle instead of showing the error screen.
 *
 * Route changes deliberately do not reload: with many deploys a day, nearly every open tab
 * fell behind within the hour, so moving between pages kept hard-refreshing mid-session
 * (players lost fights while switching loadouts). Vercel Skew Protection keeps
 * navigations on the tab's own deployment, so only a crash needs the reload.
 *
 * The one other exception is a tRPC call to a procedure the current deploy no longer has
 * ("No procedure found on path ..."). That feature cannot work again in the old bundle,
 * so the tab reloads once onto the current bundle (see `reloadIfProcedureRemoved`).
 */

/** Commit the running code was built from; `next.config.mjs` inlines it. */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "unknown";

/** Response header carrying the server's `BUILD_ID` on `/api/trpc` responses. */
export const BUILD_ID_HEADER = "x-tnr-build";

/**
 * Per-tab record of the server build a reload was last attempted for. If a reload still
 * comes back with the old bundle, the tab is not reloaded again for the same build.
 */
export const BUILD_RELOAD_STORAGE_KEY = "tnr-build-reload";

/** Builds without a commit (local and non-Vercel builds) never count as outdated. */
export const isOutdatedBuild = (
  clientBuild: string,
  serverBuild: string | null | undefined,
): serverBuild is string =>
  !!serverBuild &&
  serverBuild !== "unknown" &&
  clientBuild !== "unknown" &&
  serverBuild !== clientBuild;

/**
 * Record a reload attempt for `serverBuild`, returning false when one was already made
 * in this tab or storage is unavailable, so a stale response can never cause a loop.
 */
export const claimBuildReload = (storage: Storage, serverBuild: string) => {
  try {
    if (storage.getItem(BUILD_RELOAD_STORAGE_KEY) === serverBuild) return false;
    storage.setItem(BUILD_RELOAD_STORAGE_KEY, serverBuild);
    return true;
  } catch {
    return false;
  }
};

/** Message prefix tRPC uses when the server has no procedure for the requested path. */
export const MISSING_PROCEDURE_MESSAGE_PREFIX = "No procedure found on path";

/** Whether a tRPC error says the server has no procedure for the requested path. */
export const isMissingProcedureError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  const code = (error as { data?: { code?: unknown } | null }).data?.code;
  return (
    code === "NOT_FOUND" && error.message.startsWith(MISSING_PROCEDURE_MESSAGE_PREFIX)
  );
};

/**
 * Decide whether a tRPC error should reload the tab: only when the server provably lacks
 * the procedure the bundle asked for, the serving build is newer than the bundle, and no
 * reload was attempted for that build in this tab yet (claimed as a side effect). A
 * procedure that is also missing on the newest build therefore reloads at most once.
 */
export const shouldReloadForMissingProcedure = (opts: {
  error: unknown;
  clientBuild: string;
  serverBuild: string | null | undefined;
  storage: Storage;
}) =>
  isMissingProcedureError(opts.error) &&
  isOutdatedBuild(opts.clientBuild, opts.serverBuild) &&
  claimBuildReload(opts.storage, opts.serverBuild);

/** Build header of the response that produced a tRPC error, when tRPC attached it. */
export const getErrorServerBuild = (error: unknown) => {
  const headers = (error as { meta?: { response?: { headers?: unknown } } } | null)
    ?.meta?.response?.headers;
  return headers instanceof Headers ? headers.get(BUILD_ID_HEADER) : null;
};

let newerServerBuild: string | undefined;
let reloadPending = false;

/** True once this tab has started reloading onto a newer build. */
export const isReloadPending = () => reloadPending;

const getSessionStorage = () => {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};

/** Called with the build header of every `/api/trpc` response; absent headers are ignored. */
export const noteServerBuild = (serverBuild: string | null) => {
  if (!serverBuild) return;
  newerServerBuild = isOutdatedBuild(BUILD_ID, serverBuild) ? serverBuild : undefined;
};

/** Reload onto the current bundle when the server is ahead; returns whether it reloads. */
export const reloadIfOutdated = () => {
  if (typeof window === "undefined" || !newerServerBuild) return false;
  const storage = getSessionStorage();
  if (!storage || !claimBuildReload(storage, newerServerBuild)) return false;
  reloadPending = true;
  window.location.reload();
  return true;
};

/**
 * Reload once when a tRPC call failed because the newer server build no longer has the
 * procedure; returns whether it reloads.
 */
export const reloadIfProcedureRemoved = (error: unknown) => {
  if (typeof window === "undefined" || reloadPending) return reloadPending;
  const storage = getSessionStorage();
  if (
    !storage ||
    !shouldReloadForMissingProcedure({
      error,
      clientBuild: BUILD_ID,
      // Prefer the failed response's own build: a concurrent same-build response can
      // clear `newerServerBuild` before this error is handled.
      serverBuild: getErrorServerBuild(error) ?? newerServerBuild,
      storage,
    })
  ) {
    return false;
  }
  reloadPending = true;
  window.location.reload();
  return true;
};
