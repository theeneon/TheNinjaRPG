import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Assets, BufferImageSource, Container, Texture } from "pixi.js";
import type { GameAsset } from "@/drizzle/schema";
import type { GroundEffect, ReturnedBattle } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { createCombatEffects } from "@/libs/rendering/scenes/combatEffects";
import { makeCompleteBattle } from "../combat/helpers/battleScenario";

let sequence = 0;
const scopes: (() => void)[] = [];
beforeEach(() => {
  vi.spyOn(Assets, "load").mockImplementation(async () => new Texture({ source: new BufferImageSource({ resource: new Uint8Array(4 * 16 * 4), width: 4, height: 16 }) }));
  vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
});
afterEach(async () => { for (const cleanup of scopes.splice(0)) cleanup(); await Promise.resolve(); vi.restoreAllMocks(); });
const setup = () => {
  const owned = new Set<() => void>();
  const game = { own: (cleanup: () => void) => { owned.add(cleanup); }, disown: (cleanup: () => void) => { owned.delete(cleanup); }, invalidate: () => {},
    isDisposed: () => false, signal: new AbortController().signal } as unknown as GameRenderer;
  scopes.push(() => { for (const cleanup of owned) cleanup(); });
  const battle = makeCompleteBattle({ width: 12, height: 10 }) as unknown as ReturnedBattle;
  const grid = getBattleGrid(40, battle, { x: -20, y: -20 });
  const play = vi.fn();
  const effects = createCombatEffects(game, grid, play);
  const stage = new Container(); stage.addChild(effects.container);
  scopes.push(() => stage.destroy({ children: true, texture: false, textureSource: false }));
  const prefix = `effect-${sequence++}`;
  const assets = [
    { id: "animation", image: `https://example.com/${prefix}.png`, frames: 4, speed: 10 },
    { id: "appear", url: "appear.wav" }, { id: "disappear", url: "disappear.wav" },
  ] as unknown as GameAsset[];
  const effect = { id: "effect", type: "visual", longitude: 3, latitude: 1, power: 100, staticAnimation: "animation", appearSfx: "appear", disappearSfx: "disappear" } as GroundEffect;
  battle.groundEffects = [effect];
  const snapshot = { battle, assets, sound: true, volume: 0.4 };
  return { effects, snapshot, effect, play, owned };
};

describe("Pixi combat effects", () => {
  it("retains depleted effects without replaying sounds or recreating loops", async () => {
    const scene = setup();
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(0, false, false, null);
    const root = scene.effects.container.children[0];
    if (!root) throw new Error("Effect was not created");
    expect(scene.play.mock.calls).toEqual([["appear.wav", 0.4]]);
    scene.effect.power = 0;
    await scene.effects.sync(scene.snapshot);
    for (let frame = 0; frame < 60; frame++) scene.effects.animate(frame, false, false, null);
    expect(scene.effects.container.children).toEqual([root]); expect(root?.visible).toBe(false);
    expect(scene.play.mock.calls).toEqual([["appear.wav", 0.4], ["disappear.wav", 0.4]]);
    scene.effect.power = 100; await scene.effects.sync(scene.snapshot); scene.effects.animate(60, false, false, null);
    expect(root?.visible).toBe(true);
  });
  it("retires expired effects and their resource scopes", async () => {
    const scene = setup(); await scene.effects.sync(scene.snapshot);
    expect(scene.owned.size).toBeGreaterThan(1);
    scene.snapshot.battle.groundEffects = [];
    await scene.effects.sync(scene.snapshot);
    expect(scene.effects.count()).toBe(0); expect(scene.effects.container.children).toHaveLength(0);
    // Only the scene-level sound queue cleanup remains registered.
    expect(scene.owned.size).toBe(1);
  });
  it("releases completed one-shot views while keeping the static loop alive", async () => {
    const scene = setup(); scene.effect.appearAnimation = "animation";
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(0, false, false, null);
    const root = scene.effects.container.children[0];
    expect(root?.children).toHaveLength(2);
    scene.effects.animate(40, false, false, null);
    expect(root?.children).toHaveLength(1);
  });
  it("queues appearance and disappearance behind movement exactly once", async () => {
    const scene = setup(); await scene.effects.sync(scene.snapshot);
    scene.effects.animate(0, false, true, null);
    scene.effect.power = 0; await scene.effects.sync(scene.snapshot);
    scene.effects.animate(1, false, true, null); expect(scene.play).not.toHaveBeenCalled();
    scene.effects.animate(2, false, false, null); scene.effects.animate(51, false, false, null);
    expect(scene.play).not.toHaveBeenCalled();
    scene.effects.animate(52, false, false, null);
    expect(scene.play.mock.calls).toEqual([["appear.wav", 0.4], ["disappear.wav", 0.4]]);
    scene.effects.animate(100, false, false, null); expect(scene.play).toHaveBeenCalledTimes(2);
  });
  it.each(["initial", "muted"])("does not replay a suppressed %s disappearance", async (reason) => {
    const scene = setup(); scene.effect.power = 0;
    scene.snapshot.sound = reason !== "muted";
    await scene.effects.sync(scene.snapshot, reason === "initial");
    scene.effects.animate(0, false, false, null);
    scene.snapshot.sound = true;
    await scene.effects.sync(scene.snapshot);
    scene.effects.animate(100, false, false, null);
    expect(scene.play).not.toHaveBeenCalled();
  });
});
