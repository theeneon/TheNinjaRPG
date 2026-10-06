import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { appRouter } from "@/api/root";
import { createAppTRPCContext } from "@/server/api/trpc";
import { withRequestScope } from "@/server/requestScope";
import {
  createBotIdGuard,
  shouldGuardTrpcRequest,
  trpcPathsFromUrl,
  withBotIdGuard,
} from "@/server/utils/botid";
import { flushSafe, isExpectedTrpcRouteError, logError } from "@/server/utils/sentry";

export const runtime = "nodejs";
export const maxDuration = 90;

const handler = async (req: NextRequest) => {
  // Mutations wait for BotID's verdict (see @/server/utils/botid). Starting the check
  // here overlaps its round trip with the session lookup in createContext.
  const trpcPaths = trpcPathsFromUrl(req.url);
  const botIdGuard = shouldGuardTrpcRequest(req.method, trpcPaths)
    ? createBotIdGuard(trpcPaths)
    : undefined;
  void botIdGuard?.verify();

  const readCookies = await cookies();
  const readHeaders = await headers();

  let shouldFlush = false;

  // One memo per HTTP request, shared by every procedure in the batch: httpBatchLink
  // packs a page's whole mount into a single POST, and the shared helpers those
  // procedures call would otherwise re-read the same global rows once per procedure.
  const response = await withRequestScope(() =>
    withBotIdGuard(botIdGuard, () =>
      fetchRequestHandler({
        endpoint: "/api/trpc",
        req,
        router: appRouter,
        createContext() {
          return createAppTRPCContext({ req, readHeaders, readCookies });
        },
        onError: ({ error, path, input, ctx }) => {
          if (
            !isExpectedTrpcRouteError({
              code: error.code,
              message: error.message,
              userId: ctx?.userId,
              method: req.method,
            })
          ) {
            logError(
              error,
              `❌ tRPC failed with ${error.code} on ${path ?? "<no-path>"}. Message: ${error.message}. Input: ${JSON.stringify(input)}. Stack: ${error.stack}`,
              { input, path, error, ctx },
            );
            shouldFlush = true;
          }
        },
      }),
    ),
  );
  if (shouldFlush || botIdGuard?.needsFlush) {
    console.error("Error Detected. Flushing Sentry");
    await flushSafe();
  }

  return response;
};

export { handler as GET, handler as POST };
