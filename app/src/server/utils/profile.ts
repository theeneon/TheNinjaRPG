import { findUserRoleById, listPublicUserRows } from "@/queries/profile";
import { serverError } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { canSeeIps } from "@/utils/permissions";
import type { GetPublicUsersSchema } from "@/validators/user";

/**
 * Load public user rows and the viewer role in parallel, then enforce IP-search
 * permission and redact IP addresses before pagination is returned.
 */
export const fetchPublicUsers = async (info: {
  client: DrizzleClient;
  input: GetPublicUsersSchema;
  userId?: string | null;
  includeEffects?: boolean;
}) => {
  const { client, input, userId, includeEffects } = info;
  const currentCursor = input.cursor ? input.cursor : 0;
  const skip = currentCursor * input.limit;
  const [users, user] = await Promise.all([
    listPublicUserRows(client, input, skip, includeEffects),
    // The online-players sidebar needs only the caller's role to decide IP visibility.
    userId ? findUserRoleById(client, userId) : null,
  ]);

  // IP-based searches require permission even when the result list is empty.
  if (input.ip && (!user || !canSeeIps(user.role))) {
    throw serverError("FORBIDDEN", "You are not allowed to search IPs");
  }
  // Normalize proxy addresses before hiding all IPs from unauthorized viewers.
  users
    .filter((u) => !u.lastIp)
    .forEach((u) => {
      u.lastIp = "Proxied";
    });
  if (!user || !canSeeIps(user.role)) {
    users.forEach((u) => {
      u.lastIp = "hidden";
    });
  }
  // Advance the cursor only when the fetched page fills the requested limit.
  const nextCursor = users.length < input.limit ? null : currentCursor + 1;
  return {
    data: users,
    nextCursor: nextCursor,
  };
};
