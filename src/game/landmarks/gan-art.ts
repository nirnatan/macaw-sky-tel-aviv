import * as THREE from 'three';
import type { UvRect } from './parts';
import { loadRoundFont } from './sign';

// Painted surfaces of the kindergarten, packed in one atlas so the whole gan is a single draw call.
const SIZE = 1024;
interface Rect { x: number; y: number; w: number; h: number }
const FRONT: Rect = { x: 0, y: 0, w: 1024, h: 252 }; // 14 x 3.45 m street wall
const SIDE: Rect = { x: 0, y: 256, w: 720, h: 248 }; // 10 x 3.45 m playground wall
const ROOF: Rect = { x: 0, y: 512, w: 720, h: 504 }; // 13.4 x 9.4 m roof
const BLANK = { x: 880, y: 380 };

export const WALL_COLOR = '#ffe0c7';
const FONT = '"Varela Round", "Arial Rounded MT Bold", "Arial Hebrew", Arial, sans-serif';
const RAINBOW = ['#ff595e', '#ff924c', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93'];

const uv = (r: Rect): UvRect => [r.x / SIZE, 1 - (r.y + r.h) / SIZE, (r.x + r.w) / SIZE, 1 - r.y / SIZE];
export const ATLAS = { front: uv(FRONT), side: uv(SIDE), roof: uv(ROOF), blank: [BLANK.x / SIZE, 1 - BLANK.y / SIZE] as const };

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  for (const [dx, dy, r] of [[-1.1, 0.2, 0.7], [-0.3, -0.25, 0.95], [0.6, 0, 0.8], [1.3, 0.3, 0.55]]) circle(ctx, x + dx * s, y + dy * s, r * s, '#ffffff');
}

function sun(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = '#ff9f1c';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a - 0.14) * r * 1.1, y + Math.sin(a - 0.14) * r * 1.1);
    ctx.lineTo(x + Math.cos(a) * r * 1.6, y + Math.sin(a) * r * 1.6);
    ctx.lineTo(x + Math.cos(a + 0.14) * r * 1.1, y + Math.sin(a + 0.14) * r * 1.1);
    ctx.fill();
  }
  circle(ctx, x, y, r, '#ffd23f');
  circle(ctx, x - r * 0.35, y - r * 0.15, r * 0.1, '#5a3a1a');
  circle(ctx, x + r * 0.35, y - r * 0.15, r * 0.1, '#5a3a1a');
  circle(ctx, x - r * 0.6, y + r * 0.25, r * 0.14, '#ff9fb0');
  circle(ctx, x + r * 0.6, y + r * 0.25, r * 0.14, '#ff9fb0');
  ctx.beginPath();
  ctx.arc(x, y + r * 0.05, r * 0.45, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.lineWidth = Math.max(3, r * 0.08);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#5a3a1a';
  ctx.stroke();
}

function rainbow(ctx: CanvasRenderingContext2D, x: number, y: number, outer: number, band: number) {
  RAINBOW.forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(x, y, outer - i * band - band / 2, Math.PI, 0);
    ctx.lineWidth = band + 1;
    ctx.strokeStyle = c;
    ctx.stroke();
  });
}

function flower(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, petal: string) {
  ctx.strokeStyle = '#4caf50';
  ctx.lineWidth = s * 0.25;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + s * 2.2);
  ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    circle(ctx, x + Math.cos(a) * s * 0.6, y + Math.sin(a) * s * 0.6, s * 0.5, petal);
  }
  circle(ctx, x, y, s * 0.4, '#ffd23f');
}

function hand(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, tilt: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.55, s * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const [fx, fy, a] of [[-0.5, -0.75, -0.35], [-0.18, -0.95, -0.1], [0.15, -0.95, 0.08], [0.45, -0.75, 0.3], [0.7, 0.05, 1.1]]) {
    ctx.beginPath();
    ctx.ellipse(fx * s, fy * s, s * 0.14, s * 0.36, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x - r * 1.4, y - r * 0.1, x - r * 0.7, y - r * 1.2, x, y - r * 0.45);
  ctx.bezierCurveTo(x + r * 0.7, y - r * 1.2, x + r * 1.4, y - r * 0.1, x, y + r * 0.9);
  ctx.fillStyle = color;
  ctx.fill();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.22;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.direction = 'ltr';
}

function paintFront(ctx: CanvasRenderingContext2D) {
  const { x, y, w, h } = FRONT;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.fillStyle = WALL_COLOR;
  ctx.fillRect(0, 0, w, h);
  rainbow(ctx, 250, 262, 225, 19);
  cloud(ctx, 60, 228, 34);
  cloud(ctx, 440, 230, 34);
  const colors = ['#ff595e', '#1982c4', '#8ac926', '#ffca3a', '#6a4c93', '#ff924c'];
  colors.forEach((c, i) => hand(ctx, 520 + (i % 3) * 58, 70 + Math.floor(i / 3) * 70 + (i % 2) * 10, 22, c, (i - 2.5) * 0.15));
  for (let i = 0; i < 9; i++) flower(ctx, 500 + i * 22 + (i % 2) * 6, 205 - (i % 3) * 8, 7, colors[i % colors.length]);
  label(ctx, 'גן הדר', 768, 40, 58, '#e2557a');
  sun(ctx, 935, 78, 44);
  for (let i = 0; i < 4; i++) flower(ctx, 850 + i * 45, 200 - (i % 2) * 10, 8, colors[(i + 2) % colors.length]);
  heart(ctx, 870, 160, 14, '#ff6fa3');
  ctx.restore();
}

function paintSide(ctx: CanvasRenderingContext2D) {
  const { x, y, w, h } = SIDE;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.fillStyle = WALL_COLOR;
  ctx.fillRect(0, 0, w, h);
  sun(ctx, 120, 110, 62);
  label(ctx, 'ברוכים הבאים', 460, 46, 50, '#1aa39a');
  cloud(ctx, 660, 120, 22);
  ctx.strokeStyle = '#5a5a7a';
  ctx.lineWidth = 3;
  for (const [bx, by] of [[250, 120], [420, 105], [640, 60]]) {
    ctx.beginPath();
    ctx.arc(bx - 8, by, 8, Math.PI * 1.1, Math.PI * 1.9);
    ctx.arc(bx + 8, by, 8, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }
  const petals = ['#ff595e', '#ffca3a', '#6a4c93', '#1982c4', '#ff924c'];
  for (let i = 0; i < 16; i++) flower(ctx, 20 + i * 45, 212 - (i % 3) * 7, 8, petals[i % petals.length]);
  heart(ctx, 432, 160, 16, '#ff6fa3');
  ctx.restore();
}

function paintRoof(ctx: CanvasRenderingContext2D) {
  const { x, y, w, h } = ROOF;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.fillStyle = '#f1e4ff';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2 - 10;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    circle(ctx, cx + Math.cos(a) * 215, cy + Math.sin(a) * 215, 13, RAINBOW[i % RAINBOW.length]);
  }
  circle(ctx, cx, cy, 190, '#ffffff');
  sun(ctx, cx, cy, 105);
  for (const [sx, sy] of [[w - 60, 60], [60, h - 60], [w - 60, h - 60]]) heart(ctx, sx, sy, 26, '#ff6fa3');
  label(ctx, 'גן הדר', cx, h - 36, 46, '#6a4c93');
  ctx.restore();
}

function paint(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  paintFront(ctx);
  paintSide(ctx);
  paintRoof(ctx);
}

export function createGanAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  paint(ctx);
  void loadRoundFont().then(() => { paint(ctx); texture.needsUpdate = true; });
  return texture;
}
