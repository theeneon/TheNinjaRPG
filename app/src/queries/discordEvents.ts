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

export const DISCORD_EVENT_PREFIX = "discord-event:";
const since = (category: DiscordEventCategory) =>
  sql`(SELECT time FROM GameSetting WHERE GameSetting.id = ${`${DISCORD_EVENT_PREFIX}${category}:enabled`})`;

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

export const listDiscordEventMarkers = (client: DrizzleClient) =>
  client
    .select()
    .from(gameSetting)
    .where(like(gameSetting.id, `${DISCORD_EVENT_PREFIX}%:enabled`));

/** Retain pending and live-event starts; terminal history stays out of minute polling. */
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

const undeliveredEnd = (category: DiscordEventCategory, identity: SQL) =>
  sql`NOT EXISTS (SELECT 1 FROM DiscordEventDelivery finished WHERE finished.id = CONCAT(${`${category}:`}, SHA2(${identity}, 256), ':end') AND finished.delivered = true)`;

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

/** Resolution and rewarded names must share one SQL snapshot, including a scoring transaction's commit. */
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

/** INSERT IGNORE preserves the first committed message for each activation. */
export const initializeDiscordEventDeliveries = (
  client: DrizzleClient,
  events: DiscordEvent[],
  now: Date,
) =>
  client
    .insert(discordEventDelivery)
    .ignore()
    .values(events.map((event) => ({ ...event, createdAt: now })));

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
