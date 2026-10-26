import type { Grid } from "honeycomb-grid";
import type { BufferGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import type { RouterOutputs } from "@/app/_trpc/client";
import type { VillageStructure } from "@/drizzle/schema";
import type { TerrainHex } from "@/libs/hexgrid";
import { syncMapLocationSprites } from "@/libs/threejs/mapLocations";
import { disposeGroupPreservingShared } from "@/libs/threejs/util";

/** Static sector content; player and quest layers belong to the live scene. */
export interface SectorRenderEntry {
  wrapper: Group;
  grid: Grid<TerrainHex>;
  interaction: Group;
  assets: Group;
  animatedMaterials: MeshBasicMaterial[];
  renderKey: string;
}

/** Every input that can change static geometry, scenery or entrance sprites. */
export const sectorRenderKey = (
  entry: RouterOutputs["worldMap"]["getSectorWindow"]["sectors"][number],
  context: {
    width: number;
    lightLayout: boolean;
    userId: string | undefined;
    libraryVersion: string;
    additions: VillageStructure[];
  },
) =>
  JSON.stringify([
    entry.sector,
    entry.globalTileType,
    entry.map.width,
    entry.map.height,
    entry.map.metadata,
    entry.villageType,
    [...entry.structures, ...context.additions].map((structure) => [
      structure.id,
      structure.name,
      structure.level,
      structure.hasPage,
      structure.image,
      structure.longitude,
      structure.latitude,
      structure.route,
    ]),
    context.width,
    context.lightLayout,
    context.userId,
    context.libraryVersion,
  ]);

/**
 * Keep one recently visited window's CPU geometry across travel-page mounts.
 * Entries are removed on checkout, so two scenes never share mutable meshes.
 * GPU buffers are released on return; Three.js uploads them again on reuse.
 */
export const createSectorRenderCache = (capacity = 9, retentionMs = 5 * 60_000) => {
  const idle = new Map<
    string,
    { render: SectorRenderEntry; timer: ReturnType<typeof setTimeout> }
  >();

  const remove = (key: string) => {
    const entry = idle.get(key);
    if (entry) clearTimeout(entry.timer);
    idle.delete(key);
    return entry?.render;
  };

  return {
    take: (key: string, sector: number) => {
      const render = remove(key);
      if (!render) return;
      for (const child of render.interaction.children) {
        const mesh = child as Mesh<BufferGeometry, MeshBasicMaterial>;
        mesh.userData.sector = sector;
        mesh.userData.highlight = false;
        mesh.material.visible = false;
      }
      return render;
    },
    release: (render: SectorRenderEntry) => {
      render.wrapper.removeFromParent();
      // Entrances and decoration visibility follow the current player's live
      // quest projection. Never retain that projection in an idle sector.
      syncMapLocationSprites(render.assets, render.grid, [], []);
      disposeGroupPreservingShared(render.wrapper);
      remove(render.renderKey);
      while (idle.size >= capacity) {
        const oldest = idle.keys().next().value;
        if (oldest === undefined) break;
        remove(oldest);
      }
      const timer = setTimeout(() => remove(render.renderKey), retentionMs);
      idle.set(render.renderKey, { render, timer });
    },
    clear: () => {
      for (const key of idle.keys()) remove(key);
    },
  };
};

export const sectorRenderCache = createSectorRenderCache();
