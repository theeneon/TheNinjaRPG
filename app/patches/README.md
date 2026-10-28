WebGL 1 texture styles must skip the WebGL 2-only texture comparison state.
The PixiJS patch applies this guard to both CommonJS and ES module distributions
to prevent `INVALID_ENUM` errors. Verify WebGL 1 compatibility when updating PixiJS.
