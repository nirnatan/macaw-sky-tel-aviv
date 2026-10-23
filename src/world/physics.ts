// Spatial hash over footprints and ground areas; answers surfaceAt / collide in microseconds.
import * as THREE from 'three';
import type { Surface, SurfaceKind } from '../contracts';
import type { AreaKind, CityData, Ring } from './data';
import { DATA_HALF, pointInPolygon, pointInRing, ringBounds } from './geom';

export interface Footprint { rings: Ring[]; height: number; minHeight: number }

const CELL = 50;
const MARGIN = 400; // footprints may poke past the data box
const AREA_SURFACE: Partial<Record<AreaKind, SurfaceKind>> = {
  park: 'park', grass: 'park', forest: 'park', cemetery: 'park', farmland: 'park', beach: 'beach', water: 'water',
};

/** Compressed-sparse-row grid: cell → item ids. Built once, read many times per frame. */
class CellIndex {
  readonly n: number;
  private readonly start: Uint32Array;
  private readonly items: Uint32Array;
  constructor(bounds: [number, number, number, number][]) {
    this.n = Math.ceil((2 * (DATA_HALF + MARGIN)) / CELL);
    const counts = new Uint32Array(this.n * this.n + 1);
    const visit = (b: [number, number, number, number], fn: (cell: number) => void) => {
      const i0 = this.cell(b[0]), i1 = this.cell(b[2]), j0 = this.cell(b[1]), j1 = this.cell(b[3]);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * this.n + i);
    };
    for (const b of bounds) visit(b, (c) => counts[c + 1]++);
    for (let c = 1; c < counts.length; c++) counts[c] += counts[c - 1];
    this.start = counts;
    this.items = new Uint32Array(counts[counts.length - 1]);
    const fill = counts.slice();
    bounds.forEach((b, id) => visit(b, (c) => { this.items[fill[c]++] = id; }));
  }
  cell(v: number): number { return Math.max(0, Math.min(this.n - 1, Math.floor((v + DATA_HALF + MARGIN) / CELL))); }
  /** Calls fn for every id in the cell containing (x, z). */
  each(x: number, z: number, fn: (id: number) => void): void {
    const c = this.cell(z) * this.n + this.cell(x);
    for (let k = this.start[c], e = this.start[c + 1]; k < e; k++) fn(this.items[k]);
  }
  /** Calls fn once per id (deduplicated with `stamp`) in cells overlapping the square around (x, z). */
  eachAround(x: number, z: number, r: number, stamp: Uint32Array, tick: number, fn: (id: number) => void): void {
    const i0 = this.cell(x - r), i1 = this.cell(x + r), j0 = this.cell(z - r), j1 = this.cell(z + r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * this.n + i;
      for (let k = this.start[c], e = this.start[c + 1]; k < e; k++) {
        const id = this.items[k];
        if (stamp[id] !== tick) { stamp[id] = tick; fn(id); }
      }
    }
  }
}

interface RiverSegment { ax: number; az: number; bx: number; bz: number; halfWidth: number }
export const RIVER_HALF_WIDTH = { major: 12.5, minor: 3 };

export class CityPhysics {
  private readonly footprints: Footprint[];
  private readonly footBounds: [number, number, number, number][];
  private readonly footIndex: CellIndex;
  private readonly stamp: Uint32Array;
  private tick = 0;
  private readonly areas: { rings: Ring[]; kind: SurfaceKind }[];
  private readonly areaIndex: CellIndex;
  private readonly rivers: RiverSegment[];
  private readonly riverIndex: CellIndex;
  private readonly sea: Ring;

  constructor(data: CityData, footprints: Footprint[]) {
    this.footprints = footprints;
    this.footBounds = footprints.map((f) => ringBounds(f.rings[0]));
    this.footIndex = new CellIndex(this.footBounds);
    this.stamp = new Uint32Array(footprints.length);
    this.areas = [];
    for (const a of data.areas) {
      const kind = AREA_SURFACE[a.kind];
      if (kind) this.areas.push({ rings: a.rings, kind });
    }
    this.areaIndex = new CellIndex(this.areas.map((a) => ringBounds(a.rings[0])));
    this.rivers = [];
    for (const r of data.rivers) {
      const halfWidth = r.major ? RIVER_HALF_WIDTH.major : RIVER_HALF_WIDTH.minor;
      for (let i = 2; i < r.pts.length; i += 2) this.rivers.push({ ax: r.pts[i - 2], az: r.pts[i - 1], bx: r.pts[i], bz: r.pts[i + 1], halfWidth });
    }
    this.riverIndex = new CellIndex(this.rivers.map((s) => {
      const w = s.halfWidth;
      return [Math.min(s.ax, s.bx) - w, Math.min(s.az, s.bz) - w, Math.max(s.ax, s.bx) + w, Math.max(s.az, s.bz) + w];
    }));
    this.sea = data.sea;
  }

  insideFootprint(x: number, z: number): boolean { return this.roofAt(x, z, Infinity) > -Infinity; }

  surfaceAt(x: number, z: number, belowY = Infinity): Surface {
    const roof = this.roofAt(x, z, belowY);
    if (roof > -Infinity) return { height: roof, kind: 'roof' };
    return { height: 0, kind: this.groundKind(x, z) };
  }

  private roofAt(x: number, z: number, belowY: number): number {
    let roof = -Infinity;
    this.footIndex.each(x, z, (id) => {
      const f = this.footprints[id];
      if (f.height > belowY || f.height <= roof) return;
      const b = this.footBounds[id];
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) return;
      if (pointInPolygon(x, z, f.rings)) roof = f.height;
    });
    return roof;
  }

  private groundKind(x: number, z: number): SurfaceKind {
    let kind = 'ground' as SurfaceKind;
    this.areaIndex.each(x, z, (id) => {
      const a = this.areas[id];
      if (kind !== 'water' && pointInPolygon(x, z, a.rings)) kind = a.kind;
    });
    if (kind === 'water') return kind;
    let river = false;
    this.riverIndex.each(x, z, (id) => {
      const s = this.rivers[id];
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - s.ax - t * dx, z - s.az - t * dz) < s.halfWidth) river = true;
    });
    if (river || pointInRing(x, z, this.sea)) return 'water';
    return kind;
  }

  /** Pushes the sphere out of every wall it overlaps (circle vs polygon edges in 2D, filtered by the wall's y range). */
  collide(center: THREE.Vector3, radius: number): THREE.Vector3 | null {
    let x = center.x, z = center.z;
    const y = center.y;
    let moved = false;
    for (let pass = 0; pass < 2; pass++) {
      let pushed = false;
      this.tick++;
      this.footIndex.eachAround(x, z, radius, this.stamp, this.tick, (id) => {
        const f = this.footprints[id];
        if (y >= f.height || y + radius <= f.minHeight) return; // a center above the roof is standing on it, which surfaceAt handles
        const b = this.footBounds[id];
        if (x + radius < b[0] || x - radius > b[2] || z + radius < b[1] || z - radius > b[3]) return;
        const inside = pointInPolygon(x, z, f.rings);
        const near = closestEdgePoint(x, z, f.rings);
        if (!inside && near.d >= radius) return;
        const len = near.d || 1e-6;
        const dirX = (x - near.x) / len, dirZ = (z - near.z) / len;
        if (inside) { x = near.x - dirX * radius; z = near.z - dirZ * radius; } else { x = near.x + dirX * radius; z = near.z + dirZ * radius; }
        pushed = moved = true;
      });
      if (!pushed) break;
    }
    return moved ? new THREE.Vector3(x, y, z) : null;
  }
}

const nearest = { x: 0, z: 0, d: 0 };
function closestEdgePoint(x: number, z: number, rings: Ring[]): { x: number; z: number; d: number } {
  nearest.d = Infinity;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2, n = r.length; i < n; j = i, i += 2) {
      const ax = r[j], az = r[j + 1], dx = r[i] - ax, dz = r[i + 1] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const px = ax + t * dx, pz = az + t * dz;
      const d = Math.hypot(x - px, z - pz);
      if (d < nearest.d) { nearest.d = d; nearest.x = px; nearest.z = pz; }
    }
  }
  return nearest;
}

