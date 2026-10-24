import * as THREE from 'three';
import type { Target } from '../../world/data';

/** A flat building roof a place decorates and the bird lands on. */
export interface Roof {
  ring: number[]; // outer outline, flat [x, z, ...]
  height: number;
  center: THREE.Vector2; // point farthest from every edge
  inscribed: number; // radius of the largest circle inside the roof around center
  coverRadius: number; // circle around center that holds ~75% of the roof area
  padRadius: number; // landing pad drawn inside the inscribed circle
}

const MAX_PAD_RADIUS = 12;

function inside(ring: number[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function edgeDistance(ring: number[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[j], az = ring[j + 1], dx = ring[i] - ax, dz = ring[i + 1] - az;
    const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}

export function roofOf(id: string, target: Target): Roof {
  if (!target.building) throw new Error(`world.json has no building for ${id}`);
  const { ring, height } = target.building;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]);
    z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]);
  }
  const step = 0.5, samples: [number, number][] = [];
  let center = new THREE.Vector2(), inscribed = 0;
  for (let x = x0; x <= x1; x += step) {
    for (let z = z0; z <= z1; z += step) {
      if (!inside(ring, x, z)) continue;
      samples.push([x, z]);
      const d = edgeDistance(ring, x, z);
      if (d > inscribed) { inscribed = d; center = new THREE.Vector2(x, z); }
    }
  }
  const dists = samples.map(([x, z]) => Math.hypot(x - center.x, z - center.y)).sort((a, b) => a - b);
  const coverRadius = dists[Math.floor(dists.length * 0.75)] ?? inscribed;
  return { ring, height, center, inscribed, coverRadius, padRadius: Math.min(inscribed * 0.92, MAX_PAD_RADIUS) };
}
