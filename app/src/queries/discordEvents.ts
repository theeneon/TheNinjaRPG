import {
  and,
  eq,
  getTableColumns,
  gte,
  isNull,
  like,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { gameSetting, quest, territoryWar, war } from "@/drizzle/schema";
import type { DiscordEventCategory } from "@/libs/discordEvents";
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

/** Retain activation, pending and live-event starts; terminal history stays out of minute polling. */
export const listDiscordEventMarkers = (client: DrizzleClient, now: Date) =>
  client
    .select()
    .from(gameSetting)
    .where(
      and(
        like(gameSetting.id, `${DISCORD_EVENT_PREFIX}%`),
        or(
          eq(gameSetting.value, 0),
          gte(gameSetting.time, new Date(now.getTime() - 86_400_000)),
          like(gameSetting.id, "%:enabled"),
          and(
            like(gameSetting.id, "%:start"),
            sql`NOT EXISTS (SELECT 1 FROM GameSetting finished WHERE finished.id = CONCAT(LEFT(${gameSetting.id}, LENGTH(${gameSetting.id}) - 5), 'end') AND finished.value = 1)`,
          ),
        ),
      ),
    );

const undeliveredEnd = (category: DiscordEventCategory, identity: SQL) =>
  sql`NOT EXISTS (SELECT 1 FROM GameSetting finished WHERE finished.id = CONCAT(${`${DISCORD_EVENT_PREFIX}${category}:`}, SHA2(${identity}, 256), ':end') AND finished.value = 1)`;

export const listDiscordRaids = (client: DrizzleClient) =>
  client.query.quest.findMany({
    columns: {
      id: true,
      name: true,
      createdAt: true,
      hidden: true,
      raidBossCurrentHealth: true,
      raidEndsAt: true,
    },
    extras: {
      isExclusive:
        sql<boolean>`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${quest.content}, '$.objectives[0].task')) = 'exclusive_raid', false)`
          .mapWith(Boolean)
          .as("isExclusive"),
    },
    where: and(
      eq(quest.questType, "raid"),
      eq(quest.hidden, false),
      undeliveredEnd(
        "raids",
        sql`CONCAT(${quest.id}, ':', CAST(ROUND(UNIX_TIMESTAMP(COALESCE(${quest.raidEndsAt}, ${quest.createdAt})) * 1000) AS CHAR))`,
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

export const initializeDiscordEventDelivery = (client: DrizzleClient, id: string) =>
  client
    .insert(gameSetting)
    .ignore()
    .values({ id, name: id, time: new Date(0), value: 0 });

export const claimDiscordEventDelivery = (
  client: DrizzleClient,
  id: string,
  now: Date,
  leaseMs: number,
) =>
  client
    .update(gameSetting)
    .set({ time: now })
    .where(
      and(
        eq(gameSetting.id, id),
        eq(gameSetting.value, 0),
        lt(gameSetting.time, new Date(now.getTime() - leaseMs)),
      ),
    );

export const finishDiscordEventDelivery = (
  client: DrizzleClient,
  id: string,
  now: Date,
  delivered: boolean,
) =>
  client
    .update(gameSetting)
    .set(delivered ? { value: 1 } : { time: new Date(0) })
    .where(
      and(eq(gameSetting.id, id), eq(gameSetting.time, now), eq(gameSetting.value, 0)),
    );
