import { and, eq, isNull } from "drizzle-orm";
import { questHistory } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Plain read: embedding this predicate in a mutation would lock QuestHistory ranges. */
export const fetchIsolatedPyramid = (client: DrizzleClient, userId: string) =>
  client.query.questHistory.findFirst({
    columns: { id: true },
    where: and(
      eq(questHistory.userId, userId),
      eq(questHistory.isolated, true),
      isNull(questHistory.endAt),
      eq(questHistory.completed, 0),
    ),
  });
