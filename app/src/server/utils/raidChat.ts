import { deleteUser2conversationForPurgeRaidChatMembership } from "@/queries/raids";
import type { DrizzleClient } from "@/server/db";

/**
 * Delete user2conversation rows for a single raid-chat conversation,
 * scoped to one user or a set of users. Returns the Drizzle query so callers
 * can batch it inside their own `Promise.all`.
 *
 * Skip an unnecessary database mutation when `userIds` is empty. Callers
 * (e.g. rollback paths) may legitimately pass an empty attacker list, so
 * resolve to undefined to keep their `Promise.all` shape intact.
 */
export const purgeRaidChatMembership = (
  client: DrizzleClient,
  conversationId: string,
  userIds: string | string[],
) => {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  if (ids.length === 0) return Promise.resolve(undefined);
  return deleteUser2conversationForPurgeRaidChatMembership(client, conversationId, ids);
};
