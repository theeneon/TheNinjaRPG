export const project2DShader = `
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
vec4 project2D(vec2 point) {
  vec3 position = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(point, 1.0);
  return vec4(position.xy, 0.0, 1.0);
}
`;

export const displayColorShader = `
vec3 displayColor(vec3 linear) {
  return mix(12.92 * linear, 1.055 * pow(max(linear, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), linear));
}
vec3 linearColor(vec3 display) {
  return mix(display / 12.92, pow((display + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), display));
}
`;

/** The retained six overlapping wave patterns, driven by the scene's single clock. */
export const waterUVShader = `
vec2 waterUV(vec2 uv, float time) {
  float wave1 = sin(uv.y * 0.2 * 6.28318 + time) * 0.1;
  float wave2 = sin(uv.y * 0.2 * 4.0 + time * 1.3) * 0.05;
  float wave3 = cos(uv.x * 0.2 * 6.28318 + time * 0.7) * 0.1;
  float wave4 = cos(uv.x * 0.2 * 4.5 + time * 0.9) * 0.05;
  float wave5 = sin((uv.x + uv.y) * 0.2 * 3.0 + time * 1.1) * 0.03;
  float wave6 = cos((uv.x - uv.y) * 0.2 * 3.5 + time * 0.8) * 0.03;
  return uv + vec2(wave1 + wave2 + wave5 + wave6, wave3 + wave4 + wave5 - wave6);
}
`;
