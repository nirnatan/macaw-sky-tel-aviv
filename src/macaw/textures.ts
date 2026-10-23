import * as THREE from 'three';
import type { Palette } from './palette';

// One 1024x1024 atlas per species. Rows 0-511 hold the body (u around the torso, v along it, head end at the top),
// rows 512-767 the head as an equirectangular map, rows 768-1023 a grayscale feather vane (shaft and barbs) that
// multiplies the per-feather vertex color.
const SIZE = 1024;
const BODY_ROWS = 512;
const HEAD_ROWS = 256;
const PAD = 3 / SIZE;

export const atlas = {
  /** angle01 around the body (0 = top of the back), t along it (0 = tail base, 1 = head). */
  body: (angle01: number, t: number): [number, number] => [angle01, 0.5 + PAD + (0.5 - 2 * PAD) * t],
  /** Remaps a unit sphere's uv.y into the head band. */
  head: (u: number, sphereV: number): [number, number] => [u, 0.25 + PAD + (0.25 - 2 * PAD) * sphereV],
  /** u across the vane (0.5 = shaft), s along it (0 = base). */
  feather: (u: number, s: number): [number, number] => [u, PAD + (0.25 - 2 * PAD) * s],
  /** A patch of plain belly plumage for small feathered lumps such as the thighs. */
  bellyPatch: (u: number, v: number): [number, number] => atlas.body(0.46 + 0.08 * u, 0.55 + 0.15 * v),
};

export function createAtlas(palette: Palette, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(seed);
  paintBody(ctx, palette, rand);
  paintHead(ctx, palette, rand);
  paintFeatherVane(ctx, rand);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
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

function paintBody(ctx: CanvasRenderingContext2D, p: Palette, rand: () => number): void {
  const img = ctx.createImageData(SIZE, BODY_ROWS);
  const col = new THREE.Color();
  for (let y = 0; y < BODY_ROWS; y++) {
    const t = 1 - y / BODY_ROWS;
    for (let x = 0; x < SIZE; x++) {
      const e = Math.cos((x / SIZE) * Math.PI * 2);
      bodyColor(p, e, t, col);
      const i = (y * SIZE + x) * 4;
      img.data[i] = col.r * 255;
      img.data[i + 1] = col.g * 255;
      img.data[i + 2] = col.b * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Overlapping scalloped feathers, drawn tail first so each row overlaps the one behind it.
  let row = 0;
  for (let y = BODY_ROWS + 20; y > -40; row++) {
    const t = 1 - y / BODY_ROWS;
    const w = 16 + 16 * Math.sin(Math.PI * THREE.MathUtils.clamp(t, 0, 1)) ** 0.7;
    const count = Math.round(SIZE / w);
    const pitch = SIZE / count;
    const offset = row % 2 ? pitch / 2 : 0;
    for (let k = 0; k < count; k++) {
      const x = k * pitch + offset;
      const e = Math.cos((x / SIZE) * Math.PI * 2);
      bodyColor(p, e, t, col);
      const hsl = { h: 0, s: 0, l: 0 };
      col.getHSL(hsl);
      col.setHSL(hsl.h + (rand() - 0.5) * 0.012, hsl.s, THREE.MathUtils.clamp(hsl.l * (1 + (rand() - 0.5) * 0.14), 0, 1));
      for (const dx of [0, -SIZE, SIZE]) scallop(ctx, x + dx, y, pitch * 1.08, col);
    }
    y -= pitch * 0.5;
  }
}

function scallop(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, col: THREE.Color): void {
  if (x + w < 0 || x - w > SIZE) return;
  const h = w * 1.7;
  const r = w / 2;
  ctx.beginPath();
  ctx.moveTo(x - r, y - h);
  ctx.lineTo(x - r, y - r);
  ctx.arc(x, y - r, r, Math.PI, 0, true);
  ctx.lineTo(x + r, y - h);
  ctx.closePath();
  ctx.fillStyle = col.getStyle();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y - r, r - 0.6, Math.PI * 1.05, -Math.PI * 0.05, true);
  ctx.stroke();
}

const Y_UP = new THREE.Vector3(0, 1, 0);

function paintHead(ctx: CanvasRenderingContext2D, p: Palette, rand: () => number): void {
  const img = ctx.createImageData(SIZE, HEAD_ROWS);
  const d = new THREE.Vector3();
  const nape = new THREE.Color(p.nape);
  const forehead = new THREE.Color(p.forehead);
  const cheek = new THREE.Color(p.cheek);
  const throat = p.throat ? new THREE.Color(p.throat) : null;
  const patch = new THREE.Color(p.facePatch);
  const lines = p.faceLines ? new THREE.Color(p.faceLines) : null;
  const foreheadDir = new THREE.Vector3(0, 0.5, -0.87).normalize();
  const throatDir = new THREE.Vector3(0, -0.75, -0.66).normalize();
  const out = new THREE.Color();
  const patchCenter = new THREE.Vector3();
  const h = new THREE.Vector3();
  const v = new THREE.Vector3();
  const proj = new THREE.Vector3();

  for (let y = 0; y < HEAD_ROWS; y++) {
    const theta = ((y + 0.5) / HEAD_ROWS) * Math.PI;
    for (let x = 0; x < SIZE; x++) {
      const phi = ((x + 0.5) / SIZE) * Math.PI * 2;
      d.set(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));

      out.copy(nape);
      out.lerp(cheek, smooth(-d.y, 0.05, 0.4) * smooth(-d.z, -0.6, 0.2));
      out.lerp(forehead, 1 - smooth(d.angleTo(foreheadDir), 0.55, 0.68));
      if (throat) out.lerp(throat, 1 - smooth(d.angleTo(throatDir), 0.5, 0.62));

      // Bare facial patch: an ellipse on the sphere around the side-front of the head, in tangent-plane coordinates.
      const side = d.x < 0 ? -1 : 1;
      patchCenter.set(side * 0.74, 0.02, -0.67).normalize();
      h.crossVectors(Y_UP, patchCenter).normalize().multiplyScalar(side);
      v.crossVectors(patchCenter, h).normalize();
      proj.copy(d).addScaledVector(patchCenter, -d.dot(patchCenter));
      const px = proj.dot(h); // toward the beak
      const py = proj.dot(v); // up
      const ell = (px / 0.5) ** 2 + ((py + 0.03) / 0.36) ** 2;
      const inPatch = d.dot(patchCenter) > 0 ? 1 - smooth(ell, 0.86, 1.06) : 0;
      out.lerp(patch, inPatch);
      if (lines && inPatch > 0.5) {
        const ex = -0.17; // eye position in patch coordinates
        const ey = 0.1;
        const r = Math.hypot(px - ex, py - ey);
        const a = Math.atan2(py - ey, px - ex);
        let ink = 0;
        for (let k = 0; k < 4; k++) {
          const rk = 0.12 + k * 0.08 + 0.008 * Math.sin(a * 6 + k * 2.1);
          const band = 1 - smooth(Math.abs(r - rk), 0.007, 0.015);
          const arc = smooth(a, -2.7 + k * 0.15, -2.2 + k * 0.15) * (1 - smooth(a, 0.1, 0.45)); // from behind-below the eye round to the lores
          const beads = 0.5 + 0.5 * Math.max(0, Math.sin(a * 40 + k * 3));
          ink = Math.max(ink, band * arc * beads);
        }
        out.lerp(lines, ink * inPatch);
      }
      const speckle = 1 + (rand() - 0.5) * 0.06 * (1 - inPatch);
      const i = (y * SIZE + x) * 4;
      img.data[i] = Math.min(255, out.r * 255 * speckle);
      img.data[i + 1] = Math.min(255, out.g * 255 * speckle);
      img.data[i + 2] = Math.min(255, out.b * 255 * speckle);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, BODY_ROWS);
}

function paintFeatherVane(ctx: CanvasRenderingContext2D, rand: () => number): void {
  const rows = SIZE - BODY_ROWS - HEAD_ROWS;
  const img = ctx.createImageData(SIZE, rows);
  for (let y = 0; y < rows; y++) {
    const along = rows - y; // distance from the base in pixels
    for (let x = 0; x < SIZE; x++) {
      const dx = Math.abs(x - SIZE / 2);
      const shaftHalf = 1.5 + 4.5 * (along / rows) ** 0.6 * (1 - along / rows) + 2.5 * (1 - along / rows);
      const shaft = 1 - smooth(dx, shaftHalf * 0.6, shaftHalf * 1.8);
      const barb = Math.sin((along - 0.7 * dx) * (Math.PI * 2 / 3.2));
      const breaks = 0.75 + 0.25 * Math.sin(dx * 0.11 + along * 0.05 + rand() * 0.6);
      const edge = 1 - 0.12 * smooth(dx, SIZE * 0.36, SIZE * 0.5);
      let b = (1 + 0.045 * barb * breaks) * edge;
      b = b * (1 - 0.55 * shaft);
      const i = (y * SIZE + x) * 4;
      const g = Math.round(THREE.MathUtils.clamp(b, 0, 1) * 255);
      img.data[i] = g;
      img.data[i + 1] = g;
      img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, BODY_ROWS + HEAD_ROWS);
}
