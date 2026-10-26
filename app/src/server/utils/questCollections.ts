import { and, eq, isNotNull } from "drizzle-orm";
import { bloodline, bloodlineRolls } from "@/drizzle/schema";
import { buildBloodlineCollectionProgress } from "@/libs/bloodline";
import { getUserQuests } from "@/libs/quest";
import type { UserWithRelations } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { scopedRead } from "@/server/requestScope";
import { getFarmCollectionCount } from "@/server/utils/farming";

/**
 * Load collection snapshots only for unfinished collection goals of active quests.
 * @param inTransaction - Await queries in order on a shared PlanetScale transaction session.
 * @param preloaded - Independent reads from the profile's opening query wave. Transactions
 * always read their own snapshot on the transaction session instead.
 */
export const hydrateQuestCollections = async (
  client: DrizzleClient,
  user: NonNullable<UserWithRelations>,
  inTransaction = false,
  preloaded?: BloodlineCollectionSnapshot,
) => {
  const objectives = getUserQuests(user).flatMap((quest) =>
    quest.content.objectives.filter(
      (objective) =>
        !(user.questData ?? [])
          .find((tracker) => tracker.id === quest.id)
          ?.goals.find((goal) => goal.id === objective.id)?.done,
    ),
  );
  const hasFarming = objectives.some((o) => o.task === "farming_collection_log");
  const hasBloodlines = objectives.some((o) => o.task === "bloodline_collection");
  const snapshot = inTransaction ? undefined : preloaded;
  const queries = [
    hasFarming ? getFarmCollectionCount(client, user.userId, inTransaction) : undefined,
    hasBloodlines
      ? (snapshot?.catalogue ??
        (inTransaction
          ? queryBloodlineCollectionCatalogue(client)
          : fetchBloodlineCollectionCatalogue(client)))
      : undefined,
    hasBloodlines
      ? (snapshot?.rolls ?? fetchBloodlineCollectionRolls(client, user.userId))
      : undefined,
  ] as const;
  // Drizzle queries are lazy; independent sessions can run together, a transaction cannot.
  const [farmingCollectionCount, catalogue, rolls] = inTransaction
    ? [await queries[0], await queries[1], await queries[2]]
    : await Promise.all(queries);
  return {
    ...user,
    farmingCollectionCount,
    bloodlineCollectionProgress:
      catalogue && rolls
        ? buildBloodlineCollectionProgress(catalogue, [
            ...rolls.flatMap((roll) => (roll.bloodlineId ? [roll.bloodlineId] : [])),
            ...(user.bloodlineId ? [user.bloodlineId] : []),
          ])
        : undefined,
  };
};

/** The visible catalogue is shared within a request; ownership is always read per caller. */
export const fetchBloodlineCollectionCatalogue = (client: DrizzleClient) =>
  scopedRead("bloodlineCollectionCatalogue", () =>
    queryBloodlineCollectionCatalogue(client),
  );

export const fetchBloodlineCollectionRolls = (client: DrizzleClient, userId: string) =>
  client.query.bloodlineRolls.findMany({
    columns: { bloodlineId: true },
    where: and(
      eq(bloodlineRolls.userId, userId),
      isNotNull(bloodlineRolls.bloodlineId),
    ),
  });

const queryBloodlineCollectionCatalogue = (client: DrizzleClient) =>
  client.query.bloodline.findMany({
    columns: { id: true, rank: true, hidden: true },
    where: eq(bloodline.hidden, false),
  });

type BloodlineCollectionSnapshot = {
  catalogue: Awaited<ReturnType<typeof fetchBloodlineCollectionCatalogue>>;
  rolls: Awaited<ReturnType<typeof fetchBloodlineCollectionRolls>>;
};
