import { createHash } from "node:crypto";
import {
  EXCLUSIVE_RAID_DURATION_HOURS,
  TERRITORY_WAR_INTERVAL_HOURS,
} from "@/drizzle/constants";
import type { Quest, TerritoryWar, War } from "@/drizzle/schema";

export type DiscordEventCategory = "raids" | "wars" | "territory";
type Event = { id: string; category: DiscordEventCategory; message: string };
type Raid = { isExclusive: boolean } & Pick<
  Quest,
  "id" | "name" | "createdAt" | "hidden" | "raidBossCurrentHealth" | "raidEndsAt"
>;
type Conflict = Pick<
  War,
  "id" | "startedAt" | "endedAt" | "type" | "status" | "sector" | "combatStartedAt"
> & {
  attackerVillage: { name: string };
  defenderVillage: { name: string };
};

/** Build alerts from committed snapshots. No database or network work belongs here. */
export const buildDiscordEvents = ({
  raids,
  wars,
  territories,
  enabledAt,
  observed,
  now,
}: {
  raids: Raid[];
  wars: Conflict[];
  territories: (TerritoryWar & { winners: string[] })[];
  enabledAt: Partial<Record<DiscordEventCategory, Date>>;
  observed: Set<string>;
  now: Date;
}): Event[] => {
  const events: Event[] = [];
  if (enabledAt.raids)
    for (const raid of raids) {
      if (
        raid.hidden ||
        raid.raidBossCurrentHealth === null ||
        (raid.isExclusive && !raid.raidEndsAt)
      )
        continue;
      const starts =
        raid.isExclusive && raid.raidEndsAt
          ? new Date(
              raid.raidEndsAt.getTime() - EXCLUSIVE_RAID_DURATION_HOURS * 3_600_000,
            )
          : raid.createdAt;
      if (starts > now) continue;
      const id = discordEventKey(
        "raids",
        `${raid.id}:${raid.raidEndsAt?.getTime() ?? raid.createdAt.getTime()}`,
      );
      const defeated = raid.raidBossCurrentHealth <= 0;
      const expired = !!raid.raidEndsAt && raid.raidEndsAt <= now;
      const ended = defeated || expired;
      const known = observed.has(`${id}:start`);
      if (ended && !known && starts < enabledAt.raids) continue;
      const name = plain(raid.name);
      const link = `https://www.theninja-rpg.com/globalanbuhq`;
      events.push({
        id: `${id}:start`,
        category: "raids",
        message: `Raid started: **${name}**. ${link}`,
      });
      if (ended)
        events.push({
          id: `${id}:end`,
          category: "raids",
          message: `Raid ended: **${name}**. ${defeated ? "The boss was defeated!" : "Time expired; the boss was not defeated."} ${link}`,
        });
    }
  if (enabledAt.wars)
    for (const war of wars) {
      const id = discordEventKey("wars", war.id);
      if (
        war.startedAt > now ||
        (war.endedAt && war.endedAt < enabledAt.wars && !observed.has(`${id}:start`))
      )
        continue;
      const label =
        war.type === "WAR_RAID"
          ? "Faction raid"
          : war.type === "SECTOR_WAR"
            ? `Sector war (sector ${war.sector})`
            : "War";
      const sides = `**${plain(war.attackerVillage.name)}** vs **${plain(war.defenderVillage.name)}**`;
      const link = `https://www.theninja-rpg.com/townhall`;
      const notice =
        war.combatStartedAt && war.combatStartedAt > war.startedAt
          ? ` Combat opens <t:${Math.floor(war.combatStartedAt.getTime() / 1000)}:F>.`
          : "";
      events.push({
        id: `${id}:start`,
        category: "wars",
        message: `${label} started: ${sides}.${notice} ${link}`,
      });
      if (war.endedAt) {
        const result =
          war.status === "DRAW"
            ? "It ended in a draw."
            : war.status === "ATTACKER_VICTORY"
              ? `Winner: **${plain(war.attackerVillage.name)}**.`
              : war.status === "DEFENDER_VICTORY"
                ? `Winner: **${plain(war.defenderVillage.name)}**.`
                : "It was cancelled.";
        events.push({
          id: `${id}:end`,
          category: "wars",
          message: `${label} ended: ${sides}. ${result} ${link}`,
        });
      }
    }
  if (enabledAt.territory) {
    const latest = [...territories].sort(
      (a, b) => b.startsAt.getTime() - a.startsAt.getTime(),
    )[0];
    for (const war of territories) {
      if (
        war.startsAt > now ||
        (war.resolvedAt &&
          war.resolvedAt < enabledAt.territory &&
          !observed.has(`${discordEventKey("territory", war.id)}:start`))
      )
        continue;
      const id = discordEventKey("territory", war.id);
      const link = "https://www.theninja-rpg.com/territory-war";
      events.push({
        id: `${id}:start`,
        category: "territory",
        message: `Territory War started in **sector ${war.sector}**! ${link}`,
      });
      if (war.resolvedAt) {
        const names = war.winners.map(plain);
        events.push({
          id: `${id}:end`,
          category: "territory",
          message: `Territory War ended in **sector ${war.sector}**. ${names.length ? `Winner${names.length > 1 ? "s" : ""}: **${names.join(", ")}**.` : "No winner; no points were scored."} ${link}`,
        });
      }
    }
    if (latest?.resolvedAt) {
      const next =
        latest.resolvedAt.getTime() + TERRITORY_WAR_INTERVAL_HOURS * 3_600_000;
      const remaining = next - now.getTime();
      if (remaining > 0 && remaining <= 30 * 60_000)
        events.push({
          id: `${discordEventKey("territory", latest.id)}:warning`,
          category: "territory",
          message: `The next Territory War starts <t:${Math.floor(next / 1000)}:R> (<t:${Math.floor(next / 1000)}:F>)! https://www.theninja-rpg.com/territory-war`,
        });
    }
  }
  return events;
};

/** Neutralize user-controlled Discord formatting; allowed_mentions also restricts pings. */
const plain = (value: string) =>
  value
    .replace(/[@<>*_`~|[\]\\]/g, "")
    .replace(/[\r\n]/g, " ")
    .slice(0, 191);

/** Bounded deterministic receipt IDs include the raid activation, not only its reusable quest. */
export const discordEventKey = (category: DiscordEventCategory, identity: string) =>
  `${category}:${createHash("sha256").update(identity).digest("hex")}`;
