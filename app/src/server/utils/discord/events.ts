import { buildDiscordEvents, type DiscordEventCategory } from "@/libs/discordEvents";
import { isExternalPostingDisabled, isValidDiscordWebhook } from "@/libs/socials";
import {
  claimDiscordEventDelivery,
  finishDiscordEventDelivery,
  initializeDiscordEventDelivery,
  initializeDiscordEvents,
  listDiscordEventMarkers,
  listDiscordRaids,
  listDiscordTerritoryWars,
  listDiscordWars,
  DISCORD_EVENT_PREFIX as PREFIX,
} from "@/queries/discordEvents";
import type { DrizzleClient } from "@/server/db";

const LEASE_MS = 120_000;
const ROLE_ENV = {
  raids: "DISCORD_RAIDS_ROLE_ID",
  wars: "DISCORD_WARS_ROLE_ID",
  territory: "DISCORD_TERRITORY_WARS_ROLE_ID",
} as const;

/** Only explicitly configured, opt-in roles may be mentioned. */
export const discordEventConfig = () => {
  const webhook = process.env.DISCORD_EVENT_UPDATES;
  if (!webhook || !isValidDiscordWebhook(webhook)) return null;
  const url = new URL(webhook);
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    return null;
  const roles = Object.fromEntries(
    Object.entries(ROLE_ENV).flatMap(([category, key]) => {
      const id = process.env[key];
      return id && /^\d{1,20}$/.test(id) ? [[category, id]] : [];
    }),
  ) as Partial<Record<DiscordEventCategory, string>>;
  return Object.keys(roles).length ? { webhook, roles } : null;
};

export const discordEventPayload = (roleId: string, message: string) => ({
  content: `<@&${roleId}> ${message}`.slice(0, 2000),
  allowed_mentions: { parse: [], roles: [roleId], users: [], replied_user: false },
});

/**
 * Poll committed state, outside combat and settlement transactions. Deterministic
 * GameSetting IDs provide receipts, as they do for war delivery. A timestamp CAS
 * leases each post so overlapping ticks cannot both send it. Discord has no webhook
 * idempotency key: a crash after acceptance but before saving the receipt can repeat a post.
 */
export const syncDiscordEvents = async (client: DrizzleClient, now = new Date()) => {
  const config = discordEventConfig();
  if (!config || isExternalPostingDisabled()) return;
  const categories = Object.keys(config.roles) as DiscordEventCategory[];
  // Per-category activation markers prevent completed history from being replayed.
  await initializeDiscordEvents(client, categories, now);
  const [markers, raids, wars, territories] = await Promise.all([
    listDiscordEventMarkers(client, now),
    config.roles.raids ? listDiscordRaids(client) : [],
    config.roles.wars ? listDiscordWars(client) : [],
    config.roles.territory ? listDiscordTerritoryWars(client) : [],
  ]);
  const receipts = new Map(
    markers.map((marker) => [marker.id.slice(PREFIX.length), marker]),
  );
  const enabledAt = Object.fromEntries(
    categories.map((category) => [category, receipts.get(`${category}:enabled`)?.time]),
  );
  const events = buildDiscordEvents({
    raids,
    wars,
    territories,
    enabledAt,
    observed: new Set(receipts.keys()),
    now,
  });
  let sent = 0;
  for (const event of events) {
    if (sent >= 20) break;
    const role = config.roles[event.category];
    if (!role || receipts.get(event.id)?.value === 1) continue;
    const id = `${PREFIX}${event.id}`;
    await initializeDiscordEventDelivery(client, id);
    const claimedAt = new Date();
    const claimed = await claimDiscordEventDelivery(client, id, claimedAt, LEASE_MS);
    if (!claimed.rowsAffected) continue;
    try {
      const url = new URL(config.webhook);
      // wait=true makes Discord confirm message creation before we persist delivery.
      url.searchParams.set("wait", "true");
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(discordEventPayload(role, event.message)),
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
      sent++;
      if (!response.ok)
        throw new Error(`Discord event webhook returned ${response.status}`);
      await finishDiscordEventDelivery(client, id, claimedAt, true);
    } catch {
      // Never log the webhook URL/token. Leave the event eligible for the next tick.
      console.error("[Discord] Event announcement failed", { eventId: event.id });
      await finishDiscordEventDelivery(client, id, claimedAt, false);
      // Avoid hammering a rate-limited or unavailable webhook with the rest of the batch.
      break;
    }
  }
};
