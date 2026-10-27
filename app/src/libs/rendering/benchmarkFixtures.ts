/** Shared deterministic layout and artwork for renderer comparisons. */
export const BENCHMARK_FIXTURE_VERSION = 1;
export const BENCHMARK_FRAME_COUNT = 8;
export const BENCHMARK_FRAME_MS = 80;
export const BENCHMARK_SPRITE_SIZE = 32;

export const benchmarkSpritePosition = (
  index: number,
  elapsedMs: number,
  width: number,
  height: number,
) => {
  const seed = ((index + 1) * 2654435761) >>> 0;
  const phase = (seed % 6283) / 1000;
  const time = elapsedMs / 1000;
  const inset = BENCHMARK_SPRITE_SIZE / 2;
  return {
    x: inset + ((Math.sin(time * 0.8 + phase) + 1) / 2) * (width - inset * 2),
    y: inset + ((Math.cos(time * 0.6 + phase * 1.7) + 1) / 2) * (height - inset * 2),
  };
};

/** Eight vertical frames exercise the same layout used by GameAsset effects. */
export const createBenchmarkAtlas = (variant: number) => {
  const frameSize = 64;
  const canvas = document.createElement("canvas");
  canvas.width = frameSize;
  canvas.height = frameSize * BENCHMARK_FRAME_COUNT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot create benchmark artwork");
  for (let frame = 0; frame < BENCHMARK_FRAME_COUNT; frame++) {
    const centerY = frame * frameSize + frameSize / 2;
    context.fillStyle = `hsl(${(variant * 47 + frame * 8) % 360} 65% 55%)`;
    context.beginPath();
    context.arc(frameSize / 2, centerY, 20 + frame, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#18324b";
    context.fillRect(20, centerY - 3, 24, 6);
  }
  return canvas;
};
