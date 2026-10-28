import { FARM_PLOT_COLUMNS } from "@/drizzle/constants";

/** Farm-local units with Y downward; the scene scales this centered layout to renderer pixels. */
export const FARM_PLOT_SIZE = 1.8;
export const FARM_PLOT_GAP = 0.25;
export const FARM_VIEW_HEIGHT = 14;

/** Center of a zero-based slot, with the complete row layout centered around the origin. */
export const farmPlotPosition = (slot: number, total: number) => {
  const spacing = FARM_PLOT_SIZE + FARM_PLOT_GAP;
  return {
    x: ((slot % FARM_PLOT_COLUMNS) - (FARM_PLOT_COLUMNS - 1) / 2) * spacing,
    y:
      (Math.floor(slot / FARM_PLOT_COLUMNS) -
        (Math.ceil(total / FARM_PLOT_COLUMNS) - 1) / 2) *
      spacing,
  };
};

/** Uses the same square bounds as the soil artwork without allocating hit meshes. */
export const farmPlotAt = (x: number, y: number, total: number) => {
  const spacing = FARM_PLOT_SIZE + FARM_PLOT_GAP;
  const rows = Math.ceil(total / FARM_PLOT_COLUMNS);
  const col = Math.round(x / spacing + (FARM_PLOT_COLUMNS - 1) / 2);
  const row = Math.round(y / spacing + (rows - 1) / 2);
  const slot = row * FARM_PLOT_COLUMNS + col;
  if (col < 0 || col >= FARM_PLOT_COLUMNS || row < 0 || slot >= total) return null;
  const position = farmPlotPosition(slot, total);
  return Math.abs(x - position.x) <= FARM_PLOT_SIZE / 2 &&
    Math.abs(y - position.y) <= FARM_PLOT_SIZE / 2
    ? slot
    : null;
};
