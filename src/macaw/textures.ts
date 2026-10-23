import * as THREE from 'three';
import type { Palette } from './palette';

// One 1024x1024 color atlas and a matching normal map per species. Rows 0-511 hold the body (u around the torso,
// v along it, head end at the top), rows 512-767 the head wrapped around the skull tube, rows 768-1023 a grayscale
// feather vane (shaft and barbs) that multiplies the per-feather vertex color.
const SIZE = 1024;
const BODY_ROWS = 512;
const HEAD_ROWS = 256;
const PAD = 3 / SIZE;

export const atlas = {
  /** angle01 around the body (0 = top of the back), t along it (0 = tail base, 1 = head). */
  body: (angle01: number, t: number): [number, number] => [angle01, 0.5 + PAD + (0.5 - 2 * PAD) * t],
  /** angle01 around the skull (0 = crown, 0.25 = right cheek), t along it (0 = nape, 1 = cere). */
  head: (angle01: number, t: number): [number, number] => [angle01, 0.25 + PAD + (0.25 - 2 * PAD) * t],
  /** u across the vane (0.5 = shaft), s along it (0 = base). */
  feather: (u: number, s: number): [number, number] => [u, PAD + (0.25 - 2 * PAD) * s],
  /** A patch of plain belly plumage for small feathered lumps such as the thighs. */
  bellyPatch: (u: number, v: number): [number, number] => atlas.body(0.46 + 0.08 * u, 0.55 + 0.15 * v),
};

export interface Atlas {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  dispose(): void;
}

export function createAtlas(palette: Palette, seed: number): Atlas {
  const color = newCanvas();
  const height = newCanvas(); // grayscale relief the normal map is derived from, 0.5 = flat
  const rand = mulberry32(seed);
  paintBody(color, height, palette, rand);
  paintHead(color, palette, rand);
  paintFeatherVane(color, height, rand);
  const map = new THREE.CanvasTexture(color.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(normalMapFrom(height).canvas);
  for (const tex of [map, normalMap]) {
    tex.anisotropy = 8;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  return { map, normalMap, dispose() { map.dispose(); normalMap.dispose(); } };
}

function newCanvas(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, SIZE, SIZE);
  return ctx;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = THREE.MathUtils.smoothstep;
const c1 = new THREE.Color();
const c2 = new THREE.Color();

/** Plumage color on the torso: elevation e (1 = top of the back, -1 = belly), t along the body (0 = tail, 1 = head). */
function bodyColor(p: Palette, e: number, t: number, out: THREE.Color): THREE.Color {
  const back = c1.set(p.back).lerp(c2.set(p.rump), 1 - smooth(t, 0.05, 0.4));
  const blueBoundary = 0.3 * smooth(t, 0.7, 1); // the yellow climbs higher on the neck sides
  out.set(p.belly).lerp(back, smooth(e, blueBoundary - 0.08, blueBoundary + 0.04));
  return out;
}

/** Smooth value noise in [-1, 1] with lattice spacing `cell`; x wraps every `period` units so the body seam tiles. */
function valueNoise(x: number, y: number, cell: number, seed: number, period = SIZE): number {
  const nx = Math.round(period / cell);
  const fx = x / cell;
  const fy = y / cell;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const sx = fx - x0;
  const sy = fy - y0;
  const h = (i: number, j: number) => {
    const n = Math.sin(((i % nx) + nx) % nx * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
  };
  const ux = sx * sx * (3 - 2 * sx);
  const uy = sy * sy * (3 - 2 * sy);
  const a = THREE.MathUtils.lerp(h(x0, y0), h(x0 + 1, y0), ux);
  const b = THREE.MathUtils.lerp(h(x0, y0 + 1), h(x0 + 1, y0 + 1), ux);
  return THREE.MathUtils.lerp(a, b, uy);
}

function paintBody(ctx: CanvasRenderingContext2D, hctx: CanvasRenderingContext2D, p: Palette, rand: () => number): void {
  const img = ctx.createImageData(SIZE, BODY_ROWS);
  const col = new THREE.Color();
  for (let y = 0; y < BODY_ROWS; y++) {
    const t = 1 - y / BODY_ROWS;
    for (let x = 0; x < SIZE; x++) {
      bodyColor(p, Math.cos((x / SIZE) * Math.PI * 2), t, col);
      const i = (y * SIZE + x) * 4;
      img.data[i] = col.r * 255;
      img.data[i + 1] = col.g * 255;
      img.data[i + 2] = col.b * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Contour feathers, tail first so each row shingles over the base of the row behind it. They are drawn hard-edged
  // on a layer that is then blurred, so the tips read as soft down rather than scales; the relief canvas gets the
  // same shingles so the normal map agrees.
  const layer = newCanvas();
  layer.drawImage(ctx.canvas, 0, 0);
  layer.shadowColor = 'rgba(20, 10, 0, 0.12)';
  layer.shadowBlur = 5;
  layer.shadowOffsetY = 3;
  let row = 0;
  for (let y = BODY_ROWS + 40; y > -60; row++) {
    const t = 1 - y / BODY_ROWS;
    const w = 30 + 24 * Math.sin(Math.PI * THREE.MathUtils.clamp(t, 0, 1)) ** 0.7;
    const count = Math.round(SIZE / w);
    const pitch = SIZE / count;
    const offset = row % 2 ? pitch / 2 : 0;
    for (let k = 0; k < count; k++) {
      const x = k * pitch + offset + (rand() - 0.5) * pitch * 0.3;
      const yk = y + (rand() - 0.5) * pitch * 0.25;
      bodyColor(p, Math.cos((x / SIZE) * Math.PI * 2), t, col);
      const hsl = { h: 0, s: 0, l: 0 };
      col.getHSL(hsl);
      col.setHSL(hsl.h + (rand() - 0.5) * 0.008, hsl.s, THREE.MathUtils.clamp(hsl.l * (1 + (rand() - 0.5) * 0.06), 0, 1));
      const lean = (rand() - 0.5) * 0.3;
      for (const dx of [0, -SIZE, SIZE]) contourFeather(layer, hctx, x + dx, yk, pitch * (1.1 + rand() * 0.15), lean, col);
    }
    y -= pitch * 0.5;
  }
  ctx.filter = 'blur(1.6px)';
  ctx.drawImage(layer.canvas, 0, 0, SIZE, BODY_ROWS, 0, 0, SIZE, BODY_ROWS);
  ctx.filter = 'none';

  // Barbs: fibres along the feather axis, plus low-frequency mottling so no two patches read identical.
  const shaded = ctx.getImageData(0, 0, SIZE, BODY_ROWS);
  const d = shaded.data;
  for (let y = 0; y < BODY_ROWS; y++) {
    for (let x = 0; x < SIZE; x++) {
      const fibre = 0.6 * valueNoise(x * 4, y * 0.5, 9, 3, SIZE * 4) + 0.4 * valueNoise(x * 2, y * 0.25, 13, 5, SIZE * 2); // stretched along v
      const mottle = 0.6 * valueNoise(x, y, 90, 7) + 0.4 * valueNoise(x, y, 220, 9);
      const m = 1 + 0.045 * fibre + 0.035 * mottle;
      const i = (y * SIZE + x) * 4;
      d[i] = Math.min(255, d[i] * m);
      d[i + 1] = Math.min(255, d[i + 1] * m);
      d[i + 2] = Math.min(255, d[i + 2] * m);
    }
  }
  ctx.putImageData(shaded, 0, 0);
}

/** One contour feather tip: a soft rounded vane leaning `lean` radians, drawn in color and as relief. */
function contourFeather(ctx: CanvasRenderingContext2D, hctx: CanvasRenderingContext2D, x: number, y: number, w: number, lean: number, col: THREE.Color): void {
  if (x + w < 0 || x - w > SIZE) return;
  const h = w * 1.9;
  const r = w / 2;
  const path = new Path2D();
  path.moveTo(x - r + lean * h, y - h);
  path.bezierCurveTo(x - r * 1.05, y - h * 0.55, x - r * 0.8, y - r * 0.05, x, y);
  path.bezierCurveTo(x + r * 0.8, y - r * 0.05, x + r * 1.05, y - h * 0.55, x + r + lean * h, y - h);
  path.closePath();
  ctx.fillStyle = col.getStyle();
  ctx.fill(path);
  const relief = hctx.createLinearGradient(0, y - h, 0, y);
  relief.addColorStop(0, '#6a6a6a');
  relief.addColorStop(1, '#8e8e8e');
  hctx.fillStyle = relief;
  hctx.fill(path);
}

/**
 * Landmarks on the head band, which wraps the skull tube: angle from the crown in radians (positive = the bird's
 * right), t along the skull (0 = nape, 1 = cere). `radius` and `length` convert both to meters.
 */
export const FACE = {
  radius: 0.038,
  length: 0.1,
  eye: { angle: 1.38, t: 0.5 },
  patch: { angle: 1.78, t: 0.76, halfAngle: 0.78, halfT: 0.34 }, // the bare face: an ellipse from behind the eye to the cere
};

function paintHead(ctx: CanvasRenderingContext2D, p: Palette, rand: () => number): void {
  const img = ctx.createImageData(SIZE, HEAD_ROWS);
  const nape = new THREE.Color(p.nape);
  const forehead = new THREE.Color(p.forehead);
  const cheek = new THREE.Color(p.cheek);
  const throat = p.throat ? new THREE.Color(p.throat) : null;
  const patch = new THREE.Color(p.facePatch);
  const lines = p.faceLines ? new THREE.Color(p.faceLines) : null;
  const lid = new THREE.Color(p.eyeRing);
  const out = new THREE.Color();
  const { radius, length, eye, patch: pe } = FACE;

  for (let y = 0; y < HEAD_ROWS; y++) {
    const t = 1 - (y + 0.5) / HEAD_ROWS;
    for (let x = 0; x < SIZE; x++) {
      const angle = ((x + 0.5) / SIZE) * Math.PI * 2;
      const a = angle <= Math.PI ? angle : Math.PI * 2 - angle; // mirror the face: 0 = crown, pi = chin

      out.copy(nape);
      out.lerp(cheek, smooth(a, 1.75, 2.35) * (1 - smooth(t, 0.3, 0.55)));
      out.lerp(forehead, (1 - smooth(a, 0.75, 1.15)) * smooth(t, 0.5, 0.78));
      if (throat) out.lerp(throat, (1 - smooth(Math.PI - a, 0.5, 0.78)) * smooth(t, 0.38, 0.52));

      const ell = ((a - pe.angle) / pe.halfAngle) ** 2 + ((t - pe.t) / pe.halfT) ** 2;
      const inPatch = 1 - smooth(ell, 0.86, 1.06);
      out.lerp(patch, inPatch);

      const dx = (t - eye.t) * length; // meters toward the cere
      const dy = (a - eye.angle) * radius; // meters down the cheek
      const r = Math.hypot(dx, dy);
      if (lines && inPatch > 0.3) {
        const phi = Math.atan2(dy, dx); // 0 = straight toward the cere, pi/2 = straight down
        let ink = 0;
        for (let k = 0; k < 3; k++) {
          const rk = 0.012 + k * 0.0075 + 0.0006 * Math.sin(phi * 5 + k * 2.1);
          const band = 1 - smooth(Math.abs(r - rk), 0.0003, 0.0009);
          const arc = smooth(phi, -0.35 - k * 0.1, 0.05 - k * 0.1) * (1 - smooth(phi, 1.75 + k * 0.1, 2.2 + k * 0.1)); // lores round to under the eye
          const beads = Math.max(0, Math.sin(phi * (30 + 7 * k) + k * 3)) ** 0.6;
          ink = Math.max(ink, band * arc * beads);
        }
        out.lerp(lines, 0.8 * ink * inPatch);
      }
      out.lerp(lid, 0.6 * (1 - smooth(r, 0.0073, 0.0082)) * smooth(r, 0.0056, 0.0067)); // bare eyelid rim around the eyeball

      const speckle = 1 + (rand() - 0.5) * 0.05 * (1 - inPatch);
      const i = (y * SIZE + x) * 4;
      img.data[i] = Math.min(255, out.r * 255 * speckle);
      img.data[i + 1] = Math.min(255, out.g * 255 * speckle);
      img.data[i + 2] = Math.min(255, out.b * 255 * speckle);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, BODY_ROWS);
}

function paintFeatherVane(ctx: CanvasRenderingContext2D, hctx: CanvasRenderingContext2D, rand: () => number): void {
  const rows = SIZE - BODY_ROWS - HEAD_ROWS;
  const img = ctx.createImageData(SIZE, rows);
  const relief = hctx.createImageData(SIZE, rows);
  for (let y = 0; y < rows; y++) {
    const along = rows - y; // distance from the base in pixels
    for (let x = 0; x < SIZE; x++) {
      const dx = Math.abs(x - SIZE / 2);
      const shaftHalf = 1.5 + 4.5 * (along / rows) ** 0.6 * (1 - along / rows) + 2.5 * (1 - along / rows);
      const shaft = 1 - smooth(dx, shaftHalf * 0.6, shaftHalf * 1.8);
      const barb = Math.sin((along - 0.7 * dx) * (Math.PI * 2 / 3.2));
      const breaks = 0.75 + 0.25 * Math.sin(dx * 0.11 + along * 0.05 + rand() * 0.6);
      const edge = 1 - 0.1 * smooth(dx, SIZE * 0.36, SIZE * 0.5);
      const b = (1 + 0.03 * barb * breaks) * edge * (1 - 0.35 * shaft);
      const i = (y * SIZE + x) * 4;
      const g = Math.round(THREE.MathUtils.clamp(b, 0, 1) * 255);
      img.data[i] = g;
      img.data[i + 1] = g;
      img.data[i + 2] = g;
      img.data[i + 3] = 255;
      const hgt = Math.round(128 + 70 * shaft + 10 * barb * breaks);
      relief.data[i] = hgt;
      relief.data[i + 1] = hgt;
      relief.data[i + 2] = hgt;
      relief.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, BODY_ROWS + HEAD_ROWS);
  hctx.putImageData(relief, 0, BODY_ROWS + HEAD_ROWS);
}

/** Tangent-space normals from the relief canvas (height in the red channel), softened so edges read as down, not scales. */
function normalMapFrom(hctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
  const soft = newCanvas();
  soft.filter = 'blur(2px)';
  soft.drawImage(hctx.canvas, 0, 0);
  soft.filter = 'none';
  const src = soft.getImageData(0, 0, SIZE, SIZE).data;
  const out = newCanvas();
  const img = out.createImageData(SIZE, SIZE);
  const at = (x: number, y: number) => src[((THREE.MathUtils.clamp(y, 0, SIZE - 1)) * SIZE + ((x + SIZE) % SIZE)) * 4] / 255;
  const strength = 2.2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dhdx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dhdy = (at(x, y + 1) - at(x, y - 1)) * strength; // canvas y runs down, texture v runs up
      const len = Math.hypot(dhdx, dhdy, 1);
      const i = (y * SIZE + x) * 4;
      img.data[i] = (-dhdx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dhdy / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  out.putImageData(img, 0, 0);
  return out;
}
