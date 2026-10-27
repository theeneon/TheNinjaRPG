import {
  CanvasTexture,
  LinearFilter,
  OrthographicCamera,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import {
  BENCHMARK_FIXTURE_VERSION,
  BENCHMARK_FRAME_COUNT,
  BENCHMARK_FRAME_MS,
  BENCHMARK_SPRITE_SIZE,
  benchmarkSpritePosition,
  createBenchmarkAtlas,
} from "@/libs/rendering/benchmarkFixtures";
import { captureRenderEnvironment } from "@/libs/rendering/browserMetrics";
import { createFrameMeasurements } from "@/libs/rendering/measurements";
import { SpriteMixer } from "@/libs/threejs/SpriteMixer";
import { spriteBenchmarkSchema } from "@/validators/renderingBenchmark";

/** Uses the application's actual sprite mixer; the fixture and metrics are renderer-neutral. */
export const runSpriteBenchmark = async (
  mount: HTMLElement,
  input: unknown,
  signal: AbortSignal,
) => {
  const options = spriteBenchmarkSchema.parse(input);
  signal.throwIfAborted();
  const setupStarted = performance.now();
  const renderer = new WebGLRenderer({ antialias: options.antialias });
  const textures: CanvasTexture[] = [];
  const privateTextures: CanvasTexture[] = [];
  const sprites: Sprite[] = [];
  const measurements = createFrameMeasurements();
  const onVisibility = () => {
    if (document.hidden) measurements.invalidate("Document was hidden during capture");
  };
  const onContextLoss = () => measurements.invalidate("WebGL context was lost");
  let frameId = 0;
  try {
    renderer.setPixelRatio(options.resolution);
    renderer.setSize(options.width, options.height);
    renderer.setClearColor(0xe8eff6);
    renderer.sortObjects = false;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.maxWidth = `${options.width}px`;
    renderer.domElement.style.height = "auto";
    const scene = new Scene();
    const camera = new OrthographicCamera(0, options.width, options.height, 0, -10, 10);
    const mixer = new SpriteMixer();
    for (let index = 0; index < options.textureCount; index++) {
      const texture = new CanvasTexture(createBenchmarkAtlas(index));
      texture.colorSpace = SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = LinearFilter;
      texture.repeat.set(1, 1 / BENCHMARK_FRAME_COUNT);
      texture.offset.set(0, (BENCHMARK_FRAME_COUNT - 1) / BENCHMARK_FRAME_COUNT);
      textures.push(texture);
    }
    for (let index = 0; index < options.count; index++) {
      const base = textures[index % textures.length];
      if (!base) throw new Error("Missing benchmark texture");
      let sprite: Sprite;
      if (options.kind === "animated") {
        const texture = base.clone();
        privateTextures.push(texture);
        const actionSprite = mixer.createActionSprite(
          texture,
          1,
          BENCHMARK_FRAME_COUNT,
        );
        const action = mixer.createAction(
          actionSprite,
          0,
          BENCHMARK_FRAME_COUNT - 1,
          BENCHMARK_FRAME_MS,
        );
        action.playLoop();
        sprite = actionSprite;
      } else {
        sprite = new Sprite(new SpriteMaterial({ map: base, depthTest: false }));
      }
      sprite.scale.set(BENCHMARK_SPRITE_SIZE, BENCHMARK_SPRITE_SIZE, 1);
      const position = benchmarkSpritePosition(index, 0, options.width, options.height);
      sprite.position.set(position.x, position.y, 0);
      scene.add(sprite);
      sprites.push(sprite);
    }
    mount.appendChild(renderer.domElement);
    const setupMs = performance.now() - setupStarted;
    const gl = renderer.getContext();
    const capabilities = {
      version: String(gl.getParameter(gl.VERSION)),
      renderer: String(gl.getParameter(gl.RENDERER)),
      maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    };
    const environment = captureRenderEnvironment();
    document.addEventListener("visibilitychange", onVisibility);
    renderer.domElement.addEventListener("webglcontextlost", onContextLoss);
    onVisibility();
    await new Promise<void>((resolve, reject) => {
      let firstFrame: number | null = null;
      let previousFrame: number | null = null;
      const abort = () => reject(signal.reason ?? new Error("Benchmark canceled"));
      const finish = () => {
        signal.removeEventListener("abort", abort);
        resolve();
      };
      signal.addEventListener("abort", abort, { once: true });
      const frame = (timestamp: number) => {
        try {
          signal.throwIfAborted();
          firstFrame ??= timestamp;
          const elapsed = timestamp - firstFrame;
          if (elapsed >= options.warmupMs + options.durationMs) {
            finish();
            return;
          }
          const measured = elapsed >= options.warmupMs;
          if (measured) measurements.begin(performance.now());
          let start = performance.now();
          if (options.kind === "moving") {
            sprites.forEach((sprite, index) => {
              const position = benchmarkSpritePosition(
                index,
                elapsed,
                options.width,
                options.height,
              );
              sprite.position.set(position.x, position.y, 0);
            });
          }
          if (measured)
            measurements.stage("spriteTransforms", performance.now() - start);
          start = performance.now();
          if (options.kind === "moving")
            scene.children.sort((a, b) => b.position.y - a.position.y);
          if (measured)
            measurements.stage("groundContactSort", performance.now() - start);
          start = performance.now();
          mixer.update(previousFrame === null ? 0 : (timestamp - previousFrame) / 1000);
          previousFrame = timestamp;
          if (measured) measurements.stage("animationStep", performance.now() - start);
          start = performance.now();
          renderer.render(scene, camera);
          if (measured) {
            measurements.stage("renderSubmit", performance.now() - start);
            measurements.counter("drawCalls", renderer.info.render.calls);
            measurements.counter("triangles", renderer.info.render.triangles);
            measurements.counter("textures", renderer.info.memory.textures);
            measurements.counter("geometries", renderer.info.memory.geometries);
            measurements.end(performance.now());
          }
          frameId = requestAnimationFrame(frame);
        } catch (error) {
          signal.removeEventListener("abort", abort);
          reject(error);
        }
      };
      frameId = requestAnimationFrame(frame);
    });
    return {
      schemaVersion: 1,
      fixtureVersion: BENCHMARK_FIXTURE_VERSION,
      renderer: "three",
      options,
      environment,
      capabilities,
      setupMs,
      result: measurements.snapshot(),
    };
  } finally {
    cancelAnimationFrame(frameId);
    document.removeEventListener("visibilitychange", onVisibility);
    renderer.domElement.removeEventListener("webglcontextlost", onContextLoss);
    sprites.forEach((sprite) => {
      sprite.material.dispose();
    });
    [...textures, ...privateTextures].forEach((texture) => {
      texture.dispose();
    });
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
};
