import {
  FARM_GROWTH_STAGES,
  WORLD_CYCLE_TRANSITION_SECONDS,
  WORLD_NIGHT_BRIGHTNESS,
} from "@/drizzle/constants";
import { getWorldCycleBrightness, getWorldCycleState } from "@/libs/dayNight";
import { getNextWateringAt, getPlotGrowthStage } from "@/libs/farming";
import type { FarmPlotState } from "@/validators/farming";

/** Constant day/night phases do not need frames; only their short fades animate. */
export const farmLightingClock = (now: Date, enabled: boolean) => {
  if (!enabled) return { alpha: 0, isTransitioning: false, nextAt: null };
  const cycle = getWorldCycleState(now);
  const end = cycle.nextPhaseAt.getTime();
  const transition = end - WORLD_CYCLE_TRANSITION_SECONDS * 1000;
  const isTransitioning = now.getTime() >= transition;
  return {
    alpha:
      Math.max(0, Math.min(1, 1 - getWorldCycleBrightness(now))) *
      (1 - WORLD_NIGHT_BRIGHTNESS + 0.15),
    isTransitioning,
    nextAt: isTransitioning ? end : transition,
  };
};

/** Wake at a visible deadline rather than polling or redrawing growing crops. */
export const nextFarmVisualAt = (
  plots: readonly Pick<
    FarmPlotState,
    "seedItemId" | "plantedAt" | "finishAt" | "lastWateredAt"
  >[],
  now: Date,
  showDayNight: boolean,
) => {
  let next = farmLightingClock(now, showDayNight).nextAt ?? Number.POSITIVE_INFINITY;
  for (const plot of plots) {
    if (!plot.seedItemId || !plot.plantedAt || !plot.finishAt) continue;
    const start = plot.plantedAt.getTime(),
      end = plot.finishAt.getTime();
    if (end <= now.getTime()) continue;
    const stage = getPlotGrowthStage(plot.plantedAt, plot.finishAt, now);
    // A stage advances just after its boundary because growth uses Math.ceil.
    next = Math.min(
      next,
      end,
      start + ((end - start) * stage) / FARM_GROWTH_STAGES + 1,
    );
    const watering = getNextWateringAt(plot.lastWateredAt, now);
    if (watering) next = Math.min(next, watering.getTime());
  }
  return Number.isFinite(next) ? next : null;
};
