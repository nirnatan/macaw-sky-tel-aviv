import * as THREE from 'three';
import { project } from '../../geo';
import type { Building } from '../../world/data';

type Waypoint = readonly [lat: number, lon: number, alt: number];

// Hand-picked from a building height map so each leg stays clear: south along the Gordon/Frishman beach,
// east along a low-rise corridor, a full lap around the Azrieli towers below their tops, north along a
// tower-free strip west of the Kirya, a low swoop over Yarkon Park, then on to Hadar Yosef.
const BEACH_AND_EAST: Waypoint[] = [
  [32.08265, 34.76729, 38],
  [32.08075, 34.7665, 34],
  [32.07885, 34.76581, 30],
  [32.07799, 34.76692, 42],
  [32.07804, 34.77031, 52],
  [32.07804, 34.77402, 58],
  [32.07804, 34.77773, 62],
  [32.07786, 34.78145, 72],
  [32.07713, 34.78516, 88],
  [32.07659, 34.78834, 100],
];
const AZRIELI_LOOP = { lat: 32.07422, lon: 34.792, radius: 160, alt: 100, count: 8 };
const NORTH_AND_PARK: Waypoint[] = [
  [32.07758, 34.79141, 100],
  [32.08093, 34.79152, 95],
  [32.08428, 34.79146, 90],
  [32.08753, 34.79131, 90],
  [32.09079, 34.79099, 100],
  [32.09404, 34.79311, 75],
  [32.09658, 34.79682, 55],
  [32.09766, 34.80106, 40],
  [32.09811, 34.8053, 32],
  [32.09802, 34.80954, 30],
  [32.10037, 34.81325, 45],
  [32.10381, 34.81559, 55],
  [32.10689, 34.81718, 48],
  [32.10869, 34.81802, 38],
];

export const RING_RADIUS = 3.8; // ~8 m across
const COLLECT_RADIUS = RING_RADIUS + 1.2; // forgiving for kids
const CLEARANCE = 14; // meters above any roof within CLEAR_RADIUS
const CLEAR_RADIUS = 22;

export interface RingSpec { position: THREE.Vector3; normal: THREE.Vector3 }

function loopPoints(): THREE.Vector3[] {
  const [cx, cz] = project(AZRIELI_LOOP.lat, AZRIELI_LOOP.lon);
  // Starts due north of the towers and runs clockwise on the map (east, south, west, back north).
  return Array.from({ length: AZRIELI_LOOP.count }, (_, i) => {
    const a = -Math.PI / 2 + (i / AZRIELI_LOOP.count) * Math.PI * 2;
    return new THREE.Vector3(cx + Math.cos(a) * AZRIELI_LOOP.radius, AZRIELI_LOOP.alt, cz + Math.sin(a) * AZRIELI_LOOP.radius);
  });
}

const toVec = ([lat, lon, alt]: Waypoint) => {
  const [x, z] = project(lat, lon);
  return new THREE.Vector3(x, alt, z);
};

/** Ring positions with their flight-direction normals, lifted clear of any roof the data knows about. */
export function buildRoute(buildings: Building[]): RingSpec[] {
  const roofNear = heightGrid(buildings);
  const points = [...BEACH_AND_EAST.map(toVec), ...loopPoints(), ...NORTH_AND_PARK.map(toVec)];
  return points.map((p, i) => {
    p.y = Math.max(p.y, roofNear(p.x, p.z, CLEAR_RADIUS) + CLEARANCE);
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const normal = next.clone().sub(prev).setY(0).normalize();
    return { position: p, normal };
  });
}

/** Max roof height within r of (x, z), from a coarse grid of building bounding boxes. */
function heightGrid(buildings: Building[], cell = 10): (x: number, z: number, r: number) => number {
  const grid = new Map<number, number>();
  const key = (cx: number, cz: number) => cx * 65536 + cz;
  for (const b of buildings) {
    if (b.height > 400) continue; // a few OSM records carry absurd heights
    const ring = b.rings[0];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]);
      z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]);
    }
    for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
      for (let cz = Math.floor(z0 / cell); cz <= Math.floor(z1 / cell); cz++) {
        const k = key(cx, cz);
        grid.set(k, Math.max(grid.get(k) ?? 0, b.height));
      }
    }
  }
  return (x, z, r) => {
    let max = 0;
    for (let cx = Math.floor((x - r) / cell); cx <= Math.floor((x + r) / cell); cx++) {
      for (let cz = Math.floor((z - r) / cell); cz <= Math.floor((z + r) / cell); cz++) max = Math.max(max, grid.get(key(cx, cz)) ?? 0);
    }
    return max;
  };
}

const hit = new THREE.Vector3();
/** True when the segment a→b crosses the ring's plane inside its collect radius. */
export function passesThrough(a: THREE.Vector3, b: THREE.Vector3, ring: RingSpec): boolean {
  const da = hit.subVectors(a, ring.position).dot(ring.normal);
  const db = hit.subVectors(b, ring.position).dot(ring.normal);
  if (da === db || (da > 0 && db > 0) || (da < 0 && db < 0)) return false;
  const t = da / (da - db);
  hit.lerpVectors(a, b, t);
  return hit.distanceTo(ring.position) <= COLLECT_RADIUS;
}
