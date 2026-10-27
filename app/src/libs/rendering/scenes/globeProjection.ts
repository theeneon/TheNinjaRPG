import { sectorAtGeographic } from "@/libs/sector-map/world-grid";
import type { GlobalPoint } from "@/libs/sector-map/world-types";

export const GLOBE_HALF_FOV = (25 * Math.PI) / 180;
export type GlobeCamera = {
  longitude: number;
  latitude: number;
  distance: number;
  width: number;
  height: number;
};

export const globeCameraBasis = (camera: GlobeCamera) => {
  const c = Math.cos(camera.latitude),
    s = Math.sin(camera.latitude);
  const x = Math.cos(camera.longitude),
    z = Math.sin(camera.longitude);
  return {
    forward: { x: c * x, y: s, z: c * z },
    right: { x: z, y: 0, z: -x },
    up: { x: -s * x, y: c, z: -s * z },
  };
};

export const globeProject = (point: GlobalPoint, camera: GlobeCamera) => {
  const basis = globeCameraBasis(camera);
  const depth = camera.distance - dot(point, basis.forward);
  const scale = camera.height / (2 * Math.tan(GLOBE_HALF_FOV) * depth);
  return {
    x: camera.width / 2 + dot(point, basis.right) * scale,
    y: camera.height / 2 - dot(point, basis.up) * scale,
    depth,
    scale,
  };
};

export const globeRay = (x: number, y: number, camera: GlobeCamera) => {
  const basis = globeCameraBasis(camera);
  const rx = ((x - camera.width / 2) * 2 * Math.tan(GLOBE_HALF_FOV)) / camera.height;
  const ry = ((camera.height / 2 - y) * 2 * Math.tan(GLOBE_HALF_FOV)) / camera.height;
  const length = Math.hypot(rx, ry, 1);
  return {
    origin: {
      x: basis.forward.x * camera.distance,
      y: basis.forward.y * camera.distance,
      z: basis.forward.z * camera.distance,
    },
    direction: {
      x: (basis.right.x * rx + basis.up.x * ry - basis.forward.x) / length,
      y: (basis.right.y * rx + basis.up.y * ry - basis.forward.y) / length,
      z: (basis.right.z * rx + basis.up.z * ry - basis.forward.z) / length,
    },
  };
};

export const globeRayHit = (ray: ReturnType<typeof globeRay>, radius: number) => {
  const b = dot(ray.origin, ray.direction);
  const discriminant = b * b - dot(ray.origin, ray.origin) + radius * radius;
  if (discriminant < 0) return null;
  const distance = -b - Math.sqrt(discriminant);
  if (distance < 0) return null;
  return {
    distance,
    point: {
      x: ray.origin.x + ray.direction.x * distance,
      y: ray.origin.y + ray.direction.y * distance,
      z: ray.origin.z + ray.direction.z * distance,
    },
  };
};

export const globeSectorAt = (
  x: number,
  y: number,
  camera: GlobeCamera,
  radius: number,
) => {
  const hit = globeRayHit(globeRay(x, y, camera), radius);
  if (!hit) return null;
  const latitude =
    (Math.asin(Math.max(-1, Math.min(1, hit.point.y / radius))) * 180) / Math.PI;
  const longitude = (Math.atan2(hit.point.z, hit.point.x) * 180) / Math.PI;
  const sector = sectorAtGeographic(latitude, longitude);
  return sector < 0 ? null : sector;
};

/** Preserves the old globe's projected size while using its narrower lens. */
export const globeDistanceLimits = (radius: number) => {
  const compensate = (distance: number) => {
    const projectedRadius =
      Math.tan(Math.asin(radius / distance)) / Math.tan((75 * Math.PI) / 360);
    return radius / Math.sin(Math.atan(projectedRadius * Math.tan(GLOBE_HALF_FOV)));
  };
  return { min: compensate(16), max: compensate(22) };
};

const dot = (a: GlobalPoint, b: GlobalPoint) => a.x * b.x + a.y * b.y + a.z * b.z;
