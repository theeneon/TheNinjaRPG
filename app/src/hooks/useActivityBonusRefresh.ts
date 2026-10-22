import { useMemo } from "react";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import type { getActivityBonuses } from "@/libs/activityBonuses";

/** Reconcile passive eligibility when worn gear or its imbuements finish crafting. */
export const useActivityBonusRefresh = (
  user: Parameters<typeof getActivityBonuses>[0] | undefined,
  onRefresh: () => void,
) => {
  const items = user?.items;
  const deadlines = useMemo(
    () =>
      (items ?? [])
        .filter(
          (gear) =>
            gear.equipped !== "NONE" &&
            (gear.quantity === undefined || gear.quantity > 0) &&
            !gear.storedAtHome &&
            !gear.isInAuction,
        )
        .flatMap((gear) => [
          gear.craftingFinishedAt,
          ...(gear.item.canBeImbued
            ? (gear.imbuements ?? []).map((imbuement) => imbuement.craftingFinishedAt)
            : []),
        ]),
    [items],
  );
  // Match the local clock used by getActivityBonuses and wornGearTags. The hook's
  // boundary render also updates previews if the refreshed profile is unchanged.
  useRefreshAt(deadlines, onRefresh);
};
