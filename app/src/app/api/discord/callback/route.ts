import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { DiscordLinkResultDetails } from "@/libs/discordLink";
import { drizzleDB } from "@/server/db";
import { getDiscordConfig } from "@/server/utils/discord/config";
import {
  completeDiscordLink,
  discordLinkResultUrl,
  exchangeDiscordCode,
} from "@/server/utils/discord/linking";
import { LINK_STATE_COOKIE, verifyLinkState } from "@/server/utils/discord/secrets";
import { fetchSanctionIdentity } from "@/server/utils/sanctionTombstone";

/**
 * Discord OAuth redirect target (register it as a redirect URI in the developer portal).
 * Verifies the state against the signed-in user and the browser cookie, links the account and
 * shows the outcome on /discord/link.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirect = (result: string, details: DiscordLinkResultDetails = {}) => {
    const response = NextResponse.redirect(
      discordLinkResultUrl(request.url, result, details),
    );
    response.cookies.delete({ name: LINK_STATE_COOKIE, path: "/api/discord" });
    return response;
  };
  const config = getDiscordConfig();
  if (!config) return redirect("disabled");
  const { userId } = await auth();
  if (!userId) return redirect("signed_out");
  const nonce = (await cookies()).get(LINK_STATE_COOKIE)?.value;
  const state = url.searchParams.get("state");
  if (!verifyLinkState(state, { userId, nonce, clientSecret: config.clientSecret }))
    return redirect("invalid_state");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) return redirect("cancelled");
  try {
    const grant = await exchangeDiscordCode(config, code);
    if (!grant) return redirect("cancelled");
    const identity = await fetchSanctionIdentity(userId);
    const outcome = await completeDiscordLink(drizzleDB, config, {
      userId,
      grant,
      identity,
    });
    return redirect(outcome.result, outcome);
  } catch (error) {
    console.error("[Discord] Linking failed", error);
    return redirect("error");
  }
}
