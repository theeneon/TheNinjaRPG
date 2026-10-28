import { selectTitleForValidateTitleRewardIds } from "@/queries/title";
import type { DrizzleClient } from "@/server/db";

/**
 * Check distinct title IDs across final rewards, objectives and nested packages.
 * Return a user-facing error, or null when all references are public and available.
 */
export const validateTitleRewardIds = async (
  client: DrizzleClient,
  rewards: unknown,
) => {
  const collect = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(collect);
    if (!value || typeof value !== "object") return [];
    return Object.entries(value).flatMap(([key, child]) =>
      key === "reward_titles" && Array.isArray(child)
        ? child.filter((id): id is string => typeof id === "string")
        : collect(child),
    );
  };
  const ids = [...new Set(collect(rewards))];
  if (!ids.length) return null;
  const available = await selectTitleForValidateTitleRewardIds(client, ids);
  return available.length === ids.length
    ? null
    : "A reward title is missing, archived or private. Select an available title.";
};
