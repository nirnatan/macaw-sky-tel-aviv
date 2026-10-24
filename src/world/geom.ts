// 2D polygon math over flat rings ([x0, z0, x1, z1, ...]) and growable vertex buffers shared by the city layers.
import * as THREE from 'three';
import type { Ring } from './data';

export const DATA_HALF = 5660; // data box: x, z in [-5660, 5660] (z box is 5530 but a square keeps the grids simple)

export function hash01(n: number): number {
  let x = Math.imul(n | 0, 0x27d4eb2d) ^ 0x165667b1;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}
export function hash2(x: number, z: number, salt = 0): number {
  return hash01(Math.imul(Math.round(x * 4), 73856093) ^ Math.imul(Math.round(z * 4), 19349663) ^ Math.imul(salt + 1, 83492791));
}
/** Deterministic PRNG so the city looks the same on every load. */
export function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function ringArea(r: Ring | number[]): number {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i += 2) { const j = (i + 2) % n; a += r[i] * r[j + 1] - r[j] * r[i + 1]; }
  return a / 2;
}
export function ringBounds(r: Ring | number[]): [minX: number, minZ: number, maxX: number, maxZ: number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    const x = r[i], z = r[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return [x0, z0, x1, z1];
}
export function ringCentroid(r: Ring | number[]): [number, number] {
  let x = 0, z = 0;
  for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; }
  return [(2 * x) / r.length, (2 * z) / r.length];
}
export function pointInRing(x: number, z: number, r: Ring | number[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 2, n = r.length; i < n; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** Inside the outer ring and outside every hole. */
export function pointInPolygon(x: number, z: number, rings: Ring[]): boolean {
  if (!pointInRing(x, z, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) if (pointInRing(x, z, rings[h])) return false;
  return true;
}
function distanceToRingEdges(x: number, z: number, r: Ring | number[]): number {
  let best = Infinity;
  for (let i = 0, j = r.length - 2, n = r.length; i < n; j = i, i += 2) {
    const ax = r[j], az = r[j + 1], bx = r[i], bz = r[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
    if (d < best) best = d;
  }
  return best;
}
/** Random points inside the polygon, at least `margin` from its edges. */
export function samplePointsInPolygon(rings: Ring[], count: number, margin: number, rand: () => number, out: number[] = []): number[] {
  const [x0, z0, x1, z1] = ringBounds(rings[0]);
  for (let tries = count * 12; tries > 0 && count > 0; tries--) {
    const x = x0 + rand() * (x1 - x0), z = z0 + rand() * (z1 - z0);
    if (!pointInPolygon(x, z, rings)) continue;
    if (margin > 0 && rings.some((r) => distanceToRingEdges(x, z, r) < margin)) continue;
    out.push(x, z);
    count--;
  }
  return out;
}

/** Ring shifted inward by `d` (positive-area rings shrink, holes grow into themselves). Miter clamped at sharp corners. */
export function insetRing(r: Ring, d: number): Float32Array {
  const n = r.length, out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const p = (i + n - 2) % n, q = (i + 2) % n;
    let ax = r[i] - r[p], az = r[i + 1] - r[p + 1], bx = r[q] - r[i], bz = r[q + 1] - r[i + 1];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const n1x = -az, n1z = ax, n2x = -bz, n2z = bx; // left normals point inward for positive-area rings
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const scale = Math.min(d / Math.max(0.35, (mx * n1x + mz * n1z)), d * 2.5);
    out[i] = r[i] + mx * scale;
    out[i + 1] = r[i + 1] + mz * scale;
  }
  return out;
}

/** Triangle indices (local to the concatenated ring vertices) for a polygon with holes. */
export function triangulate(rings: Ring[]): number[] {
  const contour = toVec2(rings[0]);
  const holes = rings.slice(1).map(toVec2);
  const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
  const out: number[] = [];
  for (const t of tris) out.push(t[0], t[1], t[2]);
  return out;
}
function toVec2(r: Ring): THREE.Vector2[] {
  const v: THREE.Vector2[] = [];
  for (let i = 0; i < r.length; i += 2) v.push(new THREE.Vector2(r[i], r[i + 1]));
  return v;
}

/** Growable interleaved attribute buffers that become one BufferGeometry. Layout is fixed per writer. */
export class GeometryWriter {
  private readonly size: number;
  private data: Float32Array;
  private index: Uint32Array;
  vertexCount = 0;
  indexCount = 0;
  constructor(private readonly layout: { name: string; size: number }[], initialVertices = 1024) {
    this.size = layout.reduce((a, l) => a + l.size, 0);
    this.data = new Float32Array(initialVertices * this.size);
    this.index = new Uint32Array(initialVertices * 3);
  }
  /** Appends one vertex; `values` is the full interleaved row. Returns its index. */
  vertex(...values: number[]): number {
    if ((this.vertexCount + 1) * this.size > this.data.length) this.data = grow(this.data);
    this.data.set(values, this.vertexCount * this.size);
    return this.vertexCount++;
  }
  tri(a: number, b: number, c: number): void {
    if (this.indexCount + 3 > this.index.length) this.index = grow(this.index);
    this.index[this.indexCount++] = a; this.index[this.indexCount++] = b; this.index[this.indexCount++] = c;
  }
  /** Triangle wound so its normal points up (+y); for horizontal surfaces whose input winding is unknown. */
  triUp(a: number, b: number, c: number): void {
    const s = this.size, d = this.data;
    const ax = d[a * s], az = d[a * s + 2], bx = d[b * s], bz = d[b * s + 2], cx = d[c * s], cz = d[c * s + 2];
    if ((bx - ax) * (cz - az) - (cx - ax) * (bz - az) < 0) this.tri(a, b, c); else this.tri(a, c, b);
  }
  quad(a: number, b: number, c: number, d: number): void { this.tri(a, b, c); this.tri(a, c, d); }
  toGeometry(): THREE.BufferGeometry | null {
    if (this.indexCount === 0) return null;
    const g = new THREE.BufferGeometry();
    const buf = new THREE.InterleavedBuffer(this.data.slice(0, this.vertexCount * this.size), this.size);
    let offset = 0;
    for (const l of this.layout) {
      g.setAttribute(l.name, new THREE.InterleavedBufferAttribute(buf, l.size, offset));
      offset += l.size;
    }
    const index = this.index.subarray(0, this.indexCount);
    g.setIndex(new THREE.BufferAttribute(this.vertexCount < 0xffff ? new Uint16Array(index) : index.slice(), 1)); // 0xffff is the primitive-restart index
    g.computeBoundingSphere();
    g.computeBoundingBox();
    releaseAfterUpload(buf, g.index!);
    return g;
  }
}

/** Static city buffers keep no CPU copy once three has uploaded them; physics reads its own footprints, never these.
 *  The cost: after a lost WebGL context these buffers cannot be re-uploaded, so the page has to reload. */
export function releaseAfterUpload(...buffers: (THREE.BufferAttribute | THREE.InterleavedBuffer)[]): void {
  for (const b of buffers) b.onUpload(function (this: typeof b) { this.array = this.array.slice(0, 0); });
}
function grow<T extends Float32Array | Uint32Array>(a: T): T {
  const b = new (a.constructor as new (n: number) => T)(a.length * 2);
  b.set(a);
  return b;
}

/** Square tiles over the data box; every layer buckets its geometry by tile so frustum culling has something to cull. */
export class ChunkGrid {
  readonly n: number;
  constructor(readonly size: number, readonly half = DATA_HALF) { this.n = Math.ceil((2 * half) / size); }
  get count(): number { return this.n * this.n; }
  indexOf(x: number, z: number): number {
    const i = clampInt((x + this.half) / this.size, this.n), j = clampInt((z + this.half) / this.size, this.n);
    return j * this.n + i;
  }
  center(index: number): [number, number] {
    const i = index % this.n, j = Math.floor(index / this.n);
    return [-this.half + (i + 0.5) * this.size, -this.half + (j + 0.5) * this.size];
  }
}
function clampInt(v: number, n: number): number { return Math.max(0, Math.min(n - 1, Math.floor(v))); }

export function polylineLength(p: Ring): number {
  let l = 0;
  for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return l;
}
/** Calls `fn(x, z, dirX, dirZ)` every `spacing` meters along the polyline starting `phase` meters in. */
export function walkPolyline(p: Ring, spacing: number, phase: number, fn: (x: number, z: number, dx: number, dz: number) => void): void {
  let next = phase;
  let walked = 0;
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], az = p[i - 1], dx = p[i] - ax, dz = p[i + 1] - az;
    const len = Math.hypot(dx, dz);
    if (len === 0) continue;
    while (next <= walked + len) {
      const t = (next - walked) / len;
      fn(ax + dx * t, az + dz * t, dx / len, dz / len);
      next += spacing;
    }
    walked += len;
  }
}
