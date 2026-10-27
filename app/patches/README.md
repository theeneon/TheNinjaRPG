The PixiJS patch guards texture comparison state, which is available only in WebGL 2.
PixiJS 8.22 resets that state for ordinary textures on WebGL 1, producing an
`INVALID_ENUM` error. Both CommonJS and ES module distributions receive the same guard.
Keep this patch when updating PixiJS until its texture-style code includes the guard;
verify the WebGL 1 path before removing it.
