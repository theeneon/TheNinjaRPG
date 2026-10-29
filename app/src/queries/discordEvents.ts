import {
  and,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  like,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  discordEventDelivery,
  gameSetting,
  quest,
  territoryWar,
  war,
} from "@/drizzle/schema";
import type { DiscordEvent, DiscordEventCategory } from "@/libs/discordEvents";
import type { DrizzleClient } from "@/server/db";

/** Namespace category activation markers separately from other game settings. */
export const DISCORD_EVENT_PREFIX = "discord-event:";
/** Read the category's first activation in the same snapshot as the event query. */
const since = (category: DiscordEventCategory) =>
  sql`(SELECT time FROM GameSetting WHERE GameSetting.id = ${`${DISCORD_EVENT_PREFIX}${category}:enabled`})`;

/** Preserve each category's first activation so enabling alerts never replays completed history. */
export const initializeDiscordEvents = (
  client: DrizzleClient,
  categories: DiscordEventCategory[],
  now: Date,
) =>
  client
    .insert(gameSetting)
    .ignore()
    .values(
      categories.map((category) => ({
        id: `${DISCORD_EVENT_PREFIX}${category}:enabled`,
        name: `${DISCORD_EVENT_PREFIX}${category}:enabled`,
        time: now,
        value: 1,
      })),
    );

/** Load persisted activation times for the event builder's completed-history guards. */
export const listDiscordEventMarkers = (client: DrizzleClient) =>
  client
    .select()
    .from(gameSetting)
    .where(like(gameSetting.id, `${DISCORD_EVENT_PREFIX}%:enabled`));

/** Retain pending/recent receipts and live starts without polling all terminal history. */
export const listDiscordEventReceipts = (client: DrizzleClient, now: Date) =>
  client
    .select({ id: discordEventDelivery.id, delivered: discordEventDelivery.delivered })
    .from(discordEventDelivery)
    .where(
      or(
        eq(discordEventDelivery.delivered, false),
        gte(discordEventDelivery.createdAt, new Date(now.getTime() - 86_400_000)),
        and(
          like(discordEventDelivery.id, "%:start"),
          sql`NOT EXISTS (SELECT 1 FROM DiscordEventDelivery finished WHERE finished.id = CONCAT(LEFT(${discordEventDelivery.id}, LENGTH(${discordEventDelivery.id}) - 5), 'end') AND finished.delivered = true)`,
        ),
      ),
    );

/** Exclude delivered ends using the same SHA-256 identity as discordEventKey. */
const undeliveredEnd = (category: DiscordEventCategory, identity: SQL) =>
  sql`NOT EXISTS (SELECT 1 FROM DiscordEventDelivery finished WHERE finished.id = CONCAT(${`${category}:`}, SHA2(${identity}, 256), ':end') AND finished.delivered = true)`;

/** Select visible raid activations without delivered ends, projecting only the needed objective flag. */
export const listDiscordRaids = (client: DrizzleClient) =>
  client.query.quest.findMany({
    columns: {
      id: true,
      name: true,
      createdAt: true,
      hidden: true,
      raidBossCurrentHealth: true,
      raidStartedAt: true,
      raidEndsAt: true,
    },
    extras: {
      isExclusive: sql<
        number | string
      >`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${quest.content}, '$.objectives[0].task')) = 'exclusive_raid', false)`.as(
        "isExclusive",
      ),
    },
    where: and(
      eq(quest.questType, "raid"),
      eq(quest.hidden, false),
      undeliveredEnd(
        "raids",
        sql`CONCAT(${quest.id}, ':', CAST(ROUND(UNIX_TIMESTAMP(COALESCE(${quest.raidEndsAt}, ${quest.raidStartedAt}, ${quest.createdAt})) * 1000) AS CHAR))`,
      ),
    ),
  });

/** Read eligible conflicts and participant names together without reloading delivered results. */
export const listDiscordWars = (client: DrizzleClient) =>
  client.query.war.findMany({
    columns: {
      id: true,
      startedAt: true,
      endedAt: true,
      type: true,
      status: true,
      sector: true,
      combatStartedAt: true,
    },
    where: and(
      or(isNull(war.endedAt), gte(war.endedAt, since("wars"))),
      undeliveredEnd("wars", sql`\`war\`.\`id\``),
    ),
    with: {
      attackerVillage: { columns: { name: true } },
      defenderVillage: { columns: { name: true } },
    },
  });

/** Read resolution and rewarded names in one SQL snapshot so results cannot mix settlement states. */
export const listDiscordTerritoryWars = (client: DrizzleClient) =>
  client
    .select({
      ...getTableColumns(territoryWar),
      winners: sql<
        string[]
      >`COALESCE((SELECT JSON_ARRAYAGG(score.name) FROM TerritoryWarScore score WHERE score.warId = ${territoryWar.id} AND score.rewarded = true), JSON_ARRAY())`.mapWith(
        (value: string | string[]) =>
          typeof value === "string" ? (JSON.parse(value) as string[]) : value,
      ),
    })
    .from(territoryWar)
    .where(
      or(
        isNull(territoryWar.resolvedAt),
        and(
          gte(territoryWar.resolvedAt, since("territory")),
          undeliveredEnd("territory", sql`${territoryWar.id}`),
        ),
        sql`${territoryWar.id} = (SELECT latest.id FROM TerritoryWar latest ORDER BY latest.startsAt DESC LIMIT 1)`,
      ),
    );

/** INSERT IGNORE preserves each lifecycle phase's first committed message across retries. */
export const initializeDiscordEventDeliveries = (
  client: DrizzleClient,
  events: DiscordEvent[],
  now: Date,
) =>
  client
    .insert(discordEventDelivery)
    .ignore()
    .values(events.map((event) => ({ ...event, createdAt: now })));

/** Read a bounded, ordered batch for sequential claims; starts precede ends staged in the same tick. */
export const listPendingDiscordEvents = (
  client: DrizzleClient,
  categories: DiscordEventCategory[],
) =>
  client
    .select()
    .from(discordEventDelivery)
    .where(
      and(
        eq(discordEventDelivery.delivered, false),
        inArray(discordEventDelivery.category, categories),
      ),
    )
    // A tick can stage both phases together; send starts before their ends.
    .orderBy(
      discordEventDelivery.createdAt,
      sql`${discordEventDelivery.id} LIKE '%:end'`,
      discordEventDelivery.id,
    )
    .limit(20);

/** Atomically lease an unclaimed/expired message; only rowsAffected permits the caller to post. */
export const claimDiscordEventDelivery = (
  client: DrizzleClient,
  id: string,
  now: Date,
  leaseMs: number,
) =>
  client
    .update(discordEventDelivery)
    .set({ claimedAt: now })
    .where(
      and(
        eq(discordEventDelivery.id, id),
        eq(discordEventDelivery.delivered, false),
        or(
          isNull(discordEventDelivery.claimedAt),
          lt(discordEventDelivery.claimedAt, new Date(now.getTime() - leaseMs)),
        ),
      ),
    );

/** Finish or release only the matching lease so stale workers cannot overwrite a reclaimed delivery. */
export const finishDiscordEventDelivery = (
  client: DrizzleClient,
  id: string,
  now: Date,
  delivered: boolean,
) =>
  client
    .update(discordEventDelivery)
    .set(delivered ? { delivered: true } : { claimedAt: null })
    .where(
      and(
        eq(discordEventDelivery.id, id),
        eq(discordEventDelivery.claimedAt, now),
        eq(discordEventDelivery.delivered, false),
      ),
    );
