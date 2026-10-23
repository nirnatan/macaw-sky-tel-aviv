import * as THREE from 'three';

const CELL = 64;
const SIZE = CELL * 2;

function hash(x: number, y: number, seed: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number, seed: number): number {
  let sum = 0, amp = 0.5, freq = 1;
  for (let o = 0; o < 4; o++) { sum += amp * valueNoise(x * freq, y * freq, seed + o); amp *= 0.5; freq *= 2.03; }
  return sum / 0.9375;
}

/** 2x2 atlas of wispy flame puffs: a soft disc eroded by fbm noise so overlapping puffs read as licks of fire. */
export function createFlameSprites(): THREE.DataTexture {
  const data = new Uint8Array(SIZE * SIZE);
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * CELL, oy = Math.floor(cell / 2) * CELL;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const u = ((x + 0.5) / CELL) * 2 - 1, v = ((y + 0.5) / CELL) * 2 - 1;
        const r = Math.hypot(u, v);
        const disc = THREE.MathUtils.smoothstep(1 - r, 0, 0.75);
        const n = fbm(u * 1.8 + cell * 9.1, v * 1.8 - cell * 4.3, cell * 13);
        const wisp = THREE.MathUtils.clamp(disc * 1.5 - (1 - n) * 0.8, 0, 1);
        const core = Math.exp(-r * r * 7) * 0.35;
        const edge = THREE.MathUtils.smoothstep(1 - r, 0, 0.12); // exactly zero on the inscribed circle, so rotated lookups never clip
        data[(oy + y) * SIZE + ox + x] = Math.round(Math.min(1, (wisp + core) * edge) * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
