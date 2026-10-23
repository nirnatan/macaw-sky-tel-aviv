import * as THREE from 'three';
import type { Ring } from '../world/data';

// All environment textures are generated at startup: no downloads, deterministic, a few tens of ms.

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function repeatingTexture(data: Uint8Array, size: number) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function tileableValueNoise(size: number, period: number, seed: number) {
  const rand = mulberry32(seed);
  const lattice = Float32Array.from({ length: period * period }, rand);
  const out = new Float32Array(size * size);
  const fade = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * period, iy = Math.floor(fy), ty = fade(fy - iy);
    const y0 = iy % period, y1 = (iy + 1) % period;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period, ix = Math.floor(fx), tx = fade(fx - ix);
      const x0 = ix % period, x1 = (ix + 1) % period;
      const a = lattice[y0 * period + x0], b = lattice[y0 * period + x1];
      const c = lattice[y1 * period + x0], d = lattice[y1 * period + x1];
      out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return out;
}

function tileableFbm(size: number, basePeriod: number, octaves: number, seed: number) {
  const sum = new Float32Array(size * size);
  let amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const layer = tileableValueNoise(size, basePeriod << o, seed + o * 101);
    for (let i = 0; i < sum.length; i++) sum[i] += layer[i] * amp;
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < sum.length; i++) sum[i] /= norm;
  return sum;
}

/** R: broad cloud shapes, G: detail. Both tile. */
export function createCloudNoise(size = 256) {
  const broad = tileableFbm(size, 4, 6, 7);
  const detail = tileableFbm(size, 8, 5, 31);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = broad[i] * 255;
    data[i * 4 + 1] = detail[i] * 255;
    data[i * 4 + 3] = 255;
  }
  return repeatingTexture(data, size);
}

/** Tileable wave normals from a sum of integer-wavenumber sines. RG: slope-encoded normal xz, B: height. */
export function createWaterNormals(size = 256) {
  const rand = mulberry32(1234);
  const waves = Array.from({ length: 56 }, () => {
    const k = 2 + Math.pow(rand(), 1.6) * 38; // cycles per tile
    const angle = (rand() - 0.5) * 3.0; // spread around the onshore wind (+x)
    const kx = Math.round(Math.cos(angle) * k), ky = Math.round(Math.sin(angle) * k);
    const kLen = Math.hypot(kx, ky) || 1;
    return { kx, ky, amp: Math.pow(kLen, -1.5), phase: rand() * Math.PI * 2 };
  });
  const height = new Float32Array(size * size), dx = new Float32Array(size * size), dy = new Float32Array(size * size);
  const w = (2 * Math.PI) / size;
  for (const { kx, ky, amp, phase } of waves) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const arg = w * (kx * x + ky * y) + phase, i = y * size + x;
        const c = Math.cos(arg);
        height[i] += amp * Math.sin(arg);
        dx[i] += amp * kx * c;
        dy[i] += amp * ky * c;
      }
    }
  }
  let maxH = 0, maxS = 0;
  for (let i = 0; i < height.length; i++) {
    maxH = Math.max(maxH, Math.abs(height[i]));
    maxS = Math.max(maxS, Math.abs(dx[i]), Math.abs(dy[i]));
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < height.length; i++) {
    const nx = -dx[i] / maxS, nz = -dy[i] / maxS;
    data[i * 4] = (nx * 0.5 + 0.5) * 255;
    data[i * 4 + 1] = (nz * 0.5 + 0.5) * 255;
    data[i * 4 + 2] = (height[i] / maxH * 0.5 + 0.5) * 255;
    data[i * 4 + 3] = 255;
  }
  return repeatingTexture(data, size);
}

// Felzenszwalb & Huttenlocher 1D squared distance transform, in place over a strided line.
function edt1d(f: Float32Array, offset: number, stride: number, n: number, v: Int32Array, z: Float32Array, d: Float32Array) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    const fq = f[offset + q * stride];
    let s: number;
    do {
      const p = v[k];
      s = (fq + q * q - (f[offset + p * stride] + p * p)) / (2 * q - 2 * p);
    } while (s <= z[k] && --k >= 0);
    k++;
    v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[offset + p * stride];
  }
  for (let q = 0; q < n; q++) f[offset + q * stride] = d[q];
}

export const SHORE_MAX_DISTANCE = 320; // meters encoded in the shore texture's full range

const MAX_SHORE_EDGE = 2000; // sea-ring edges longer than this are the artificial closure far out at sea

/** Distance from the shoreline (the sea ring's short edges), sampled by world xz through `rect` = (minX, minZ, 1/width, 1/depth). */
export function createShoreDistance(sea: Ring, texel = 8, margin = 400) {
  const count = sea.length / 2;
  const edges: number[] = [];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const ax = sea[i * 2], az = sea[i * 2 + 1], bx = sea[j * 2], bz = sea[j * 2 + 1];
    if (Math.hypot(bx - ax, bz - az) < MAX_SHORE_EDGE) edges.push(ax, az, bx, bz);
  }
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < edges.length; i += 2) {
    minX = Math.min(minX, edges[i]); maxX = Math.max(maxX, edges[i]);
    minZ = Math.min(minZ, edges[i + 1]); maxZ = Math.max(maxZ, edges[i + 1]);
  }
  minX -= margin; minZ -= margin; maxX += margin; maxZ += margin;
  const w = Math.ceil((maxX - minX) / texel), h = Math.ceil((maxZ - minZ) / texel);
  const far = (w + h) * (w + h);
  const f = new Float32Array(w * h).fill(far);
  for (let i = 0; i < edges.length; i += 4) {
    const ax = (edges[i] - minX) / texel, az = (edges[i + 1] - minZ) / texel;
    const bx = (edges[i + 2] - minX) / texel, bz = (edges[i + 3] - minZ) / texel;
    const ex = bx - ax, ez = bz - az, len2 = ex * ex + ez * ez || 1;
    // Seed texels near the edge with their exact squared distance (texel centers), so the transform stays sub-texel accurate.
    for (let z = Math.max(0, Math.floor(Math.min(az, bz) - 2)); z <= Math.min(h - 1, Math.ceil(Math.max(az, bz) + 2)); z++) {
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx) - 2)); x <= Math.min(w - 1, Math.ceil(Math.max(ax, bx) + 2)); x++) {
        const px = x + 0.5 - ax, pz = z + 0.5 - az;
        const t = Math.min(1, Math.max(0, (px * ex + pz * ez) / len2));
        const dx = px - ex * t, dz = pz - ez * t;
        f[z * w + x] = Math.min(f[z * w + x], dx * dx + dz * dz);
      }
    }
  }
  const n = Math.max(w, h);
  const v = new Int32Array(n), z = new Float32Array(n + 1), d = new Float32Array(n);
  for (let y = 0; y < h; y++) edt1d(f, y * w, 1, w, v, z, d);
  for (let x = 0; x < w; x++) edt1d(f, x, w, h, v, z, d);
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = Math.min(255, (Math.sqrt(f[i]) * texel / SHORE_MAX_DISTANCE) * 255);
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1; // rows are w bytes, not a multiple of 4
  tex.needsUpdate = true;
  return { texture: tex, rect: new THREE.Vector4(minX, minZ, 1 / (w * texel), 1 / (h * texel)) };
}
