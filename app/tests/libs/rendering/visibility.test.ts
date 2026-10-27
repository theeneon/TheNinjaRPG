import { describe, expect, it } from "bun:test";
import { Container, Sprite } from "pixi.js";

import { isObjectChainVisible } from "@/libs/rendering/visibility";

/** Builds a scene-like chain: root -> group -> sprite, returning all three. */
const buildChain = () => {
  const root = new Container();
  const group = new Container();
  const sprite = new Sprite();
  group.addChild(sprite);
  root.addChild(group);
  return { root, group, sprite };
};

describe("isObjectChainVisible", () => {
  it("accepts an object whose whole ancestor chain is visible", () => {
    const { sprite } = buildChain();
    expect(isObjectChainVisible(sprite)).toBe(true);
  });

  it("rejects an object that is itself hidden", () => {
    const { sprite } = buildChain();
    sprite.visible = false;
    expect(isObjectChainVisible(sprite)).toBe(false);
  });

  it("rejects a visible sprite inside a hidden group, as left by despawned users", () => {
    const { group, sprite } = buildChain();
    group.visible = false;
    expect(sprite.visible).toBe(true);
    expect(isObjectChainVisible(sprite)).toBe(false);
  });

  it("rejects any hidden ancestor higher up the chain", () => {
    const { root, sprite } = buildChain();
    root.visible = false;
    expect(isObjectChainVisible(sprite)).toBe(false);
  });
});
