export const globeCameraShader = `
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uForward;
uniform float uDistance;
uniform vec2 uViewport;
uniform float uTanHalfFov;
vec3 cameraPoint(vec3 point) {
  return vec3(dot(point, uRight), dot(point, uUp), uDistance - dot(point, uForward));
}
vec4 globeProject(vec3 point) {
  vec3 view = cameraPoint(point);
  float near = 0.5;
  float far = 1000.0;
  return vec4(view.x / (uTanHalfFov * uViewport.x / uViewport.y),
              view.y / uTanHalfFov,
              (far + near) / (far - near) * view.z - 2.0 * far * near / (far - near), view.z);
}
`;

/** Per-fragment visibility clips billboards correctly while crossing the sphere's limb. */
export const globeOcclusionShader = `
uniform float uRadius;
uniform float uDistance;
bool behindGlobe(vec3 view) {
  vec3 normalizedView = view / uRadius;
  vec3 ray = normalize(normalizedView);
  float centre = uDistance / uRadius;
  float b = centre * ray.z;
  float discriminant = b * b - centre * centre + 1.0;
  if (discriminant < 0.0) return false;
  float firstHit = b - sqrt(discriminant);
  return firstHit >= 0.0 && firstHit < length(normalizedView) - 0.001;
}
`;
