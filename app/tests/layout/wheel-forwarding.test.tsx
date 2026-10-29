import { ensureDom } from "../setup/dom.mjs";
import { cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "bun:test";
import { forwardVerticalWheelToDocumentScroll } from "@/components/layout/shared/layoutUtils";
import { createGlobeControls } from "@/libs/rendering/scenes/globeControls";
import type { GlobeCamera } from "@/libs/rendering/scenes/globeProjection";

ensureDom();

const originalScrollingElement = Object.getOwnPropertyDescriptor(document, "scrollingElement");

afterEach(() => {
  cleanup();
  if (originalScrollingElement) {
    Object.defineProperty(document, "scrollingElement", originalScrollingElement);
  } else {
    Reflect.deleteProperty(document, "scrollingElement");
  }
});

const setup = () => {
  const page = document.createElement("div");
  Object.defineProperty(document, "scrollingElement", { configurable: true, value: page });
  Object.defineProperty(page, "scrollHeight", { value: 2000 });
  Object.defineProperty(page, "clientHeight", { value: 500 });
  page.scrollTop = 500;
  return render(
    <div onWheel={forwardVerticalWheelToDocumentScroll}>
      <canvas data-testid="map" />
      <div data-testid="content">Page content</div>
    </div>,
  );
};

describe("layout wheel forwarding", () => {
  it.each([-100, 100])("preserves map zoom without page scroll for delta %s", (deltaY) => {
    const view = setup();
    const camera: GlobeCamera = { longitude: 0, latitude: 0, distance: 100, width: 300, height: 150 };
    const canvas = view.getByTestId("map") as HTMLCanvasElement;
    const listeners = new window.AbortController();
    const cleanups: (() => void)[] = [];
    createGlobeControls({
      canvas,
      listen: (type, listener) => canvas.addEventListener(type, listener, { signal: listeners.signal }),
      own: (callback) => { cleanups.push(callback); },
    }, camera, { min: 50, max: 200, latitude: 1.2 }, () => {});
    try {
      fireEvent.wheel(canvas, { deltaY, bubbles: true, cancelable: true });
      expect(document.scrollingElement?.scrollTop).toBe(500);
      if (deltaY > 0) expect(camera.distance).toBeGreaterThan(100);
      else expect(camera.distance).toBeLessThan(100);
    } finally {
      listeners.abort();
      for (const cleanup of cleanups) cleanup();
    }
  });

  it("forwards vertical wheel input the browser did not scroll", async () => {
    const view = setup();
    fireEvent.wheel(view.getByTestId("content"), { deltaY: 100 });
    await nextFrames(3);
    expect(document.scrollingElement?.scrollTop).toBe(600);
  });

  it("does not scroll again when the browser already scrolled the document", async () => {
    const view = setup();
    fireEvent.wheel(view.getByTestId("content"), { deltaY: 100 });
    const page = document.scrollingElement as HTMLElement;
    page.scrollTop = 540; // Native smooth scroll in progress.
    await nextFrames(3);
    expect(page.scrollTop).toBe(540);
  });

  it("combines rapid wheel input into one forwarded scroll", async () => {
    const view = setup();
    const content = view.getByTestId("content");
    fireEvent.wheel(content, { deltaY: 100 });
    fireEvent.wheel(content, { deltaY: 100 });
    await nextFrames(3);
    expect(document.scrollingElement?.scrollTop).toBe(700);
  });

  it.each([
    { startTop: 0, deltas: [100, -100], expectedTop: 0 },
    { startTop: 1500, deltas: [-100, 100], expectedTop: 1500 },
    { startTop: 10, deltas: [-100, 100], expectedTop: 100 },
    { startTop: 1490, deltas: [100, -100], expectedTop: 1400 },
  ])(
    "preserves rapid wheel reversals at scroll position $startTop",
    async ({ startTop, deltas, expectedTop }) => {
      const view = setup();
      const page = document.scrollingElement as HTMLElement;
      page.scrollTop = startTop;
      const content = view.getByTestId("content");
      for (const deltaY of deltas) fireEvent.wheel(content, { deltaY });
      await nextFrames(3);
      expect(page.scrollTop).toBe(expectedTop);
    },
  );
});

const nextFrames = async (count: number) => {
  for (let i = 0; i < count; i++) {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  }
};
