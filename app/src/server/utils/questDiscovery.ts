import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { quest } from "@/drizzle/schema";
import {
  type QuestDiscoveryOptions,
  questLevelFilters,
  selectQuestForFetchQuestDiscoveryCandidates,
  selectQuestForFetchQuestDiscoverySummaryCandidates,
} from "@/queries/quests";

import type { DrizzleClient } from "@/server/db";

/**
 * Shared candidate query for quest discovery screens. Availability remains the caller's
 * responsibility because each destination adds its own contextual rules (war state, structure,
 * occupation, or NPC discovery). Keeping this join shared prevents dashboard discovery from
 * loading the full profile independently for every content category.
 */
export const fetchQuestDiscoveryCandidates = async (
  client: DrizzleClient,
  userId: string,
  options: QuestDiscoveryOptions,
) =>
  selectQuestForFetchQuestDiscoveryCandidates(
    client,
    userId,
    buildQuestDiscoveryWhere(options),
  );

/**
 * Discovery inputs without objective JSON. Authorize hidden summaries in the join,
 * because callers resolve display eligibility against the cached client profile.
 */
export const fetchQuestDiscoverySummaryCandidates = async (
  client: DrizzleClient,
  userId: string,
  options: QuestDiscoveryOptions,
) =>
  selectQuestForFetchQuestDiscoverySummaryCandidates(
    client,
    userId,
    buildQuestDiscoveryWhere(options),
  );

const buildQuestDiscoveryWhere = (options: QuestDiscoveryOptions) =>
  and(
    inArray(quest.questType, options.questTypes),
    options.villageId
      ? or(isNull(quest.requiredVillage), eq(quest.requiredVillage, options.villageId))
      : undefined,
    options.ranks?.length ? inArray(quest.questRank, options.ranks) : undefined,
    ...(options.level !== undefined ? questLevelFilters(options.level) : []),
  );
