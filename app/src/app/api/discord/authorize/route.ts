import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { findUserIdentityById } from "@/queries/profile";

import { drizzleDB } from "@/server/db";
import { getDiscordConfig } from "@/server/utils/discord/config";
import {
  completeDiscordLink,
  discordLinkResultUrl,
  resolveClerkDiscordGrant,
} from "@/server/utils/discord/linking";
import { buildAuthorizeUrl } from "@/server/utils/discord/rest";
import {
  createLinkState,
  LINK_STATE_COOKIE,
  LINK_STATE_TTL_MS,
} from "@/server/utils/discord/secrets";
import { fetchSanctionIdentity } from "@/server/utils/sanctionTombstone";

/**
 * Start Discord linking. When the player signs in with Discord and Clerk's token already
 * carries `role_connections.write`, the link is completed right here from that token.
 * Otherwise bind a signed OAuth state to the signed-in character and this browser, then send
 * the player to Discord's consent screen. OAuth needs a redirect with a cookie, which a tRPC
 * call cannot provide.
 */
export async function GET(request: Request) {
  const config = getDiscordConfig();
  if (!config)
    return NextResponse.redirect(discordLinkResultUrl(request.url, "disabled"));
  const { userId } = await auth();
  if (!userId)
    return NextResponse.redirect(
      new URL(
        `/login?redirect_url=${encodeURIComponent("/discord/link")}`,
        request.url,
      ),
    );
  const character = await findUserIdentityById(drizzleDB, userId);
  if (!character)
    return NextResponse.redirect(discordLinkResultUrl(request.url, "no_character"));
  // Linking without a consent screen only follows a click on our own pages: a same-origin
  // top-level navigation. Another site, or an image embedded in user content, gets the
  // consent screen instead.
  const headers = request.headers;
  if (
    headers.get("sec-fetch-site") === "same-origin" &&
    headers.get("sec-fetch-mode") === "navigate" &&
    headers.get("sec-fetch-dest") === "document"
  ) {
    let grant: Awaited<ReturnType<typeof resolveClerkDiscordGrant>> = null;
    try {
      grant = await resolveClerkDiscordGrant(config, userId);
    } catch (error) {
      console.error("[Discord] Clerk sign-in token unavailable, using consent", error);
    }
    if (grant) {
      // Once a link may have been stored, a failure is reported instead of starting the
      // consent flow, which would only answer "relinked" for the half-finished link.
      try {
        const identity = await fetchSanctionIdentity(userId);
        const outcome = await completeDiscordLink(drizzleDB, config, {
          userId,
          grant,
          identity,
        });
        return NextResponse.redirect(
          discordLinkResultUrl(request.url, outcome.result, {
            ...outcome,
            automatic: true,
          }),
        );
      } catch (error) {
        console.error("[Discord] Linking from the Clerk sign-in failed", error);
        return NextResponse.redirect(discordLinkResultUrl(request.url, "error"));
      }
    }
  }
  const { state, nonce } = createLinkState(userId, config.clientSecret);
  const response = NextResponse.redirect(buildAuthorizeUrl(config, state));
  response.cookies.set(LINK_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/api/discord",
    maxAge: LINK_STATE_TTL_MS / 1000,
  });
  return response;
}
