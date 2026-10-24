import * as THREE from 'three';
import { fxMaterial } from './fx';
import { lit, luminance, type Mood } from './mood';

const FONT_URL = 'https://fonts.googleapis.com/css2?family=Varela+Round&display=swap';
const FONT_STACK = '"Varela Round", "Arial Rounded MT Bold", "Arial Hebrew", Arial, sans-serif';
const W = 1024, H = 512;
const M_PER_PX = 15 / H;
const BOARD = { halfW: (W / 2 - 20) * M_PER_PX, halfH: 205 * M_PER_PX, y: 7.5 - 225 * M_PER_PX, radius: 70 * M_PER_PX }; // the outer rounded rect drawn below
const HALO_MARGIN = 6;
const HALO_LUMINANCE = 1.3; // halo rim radiance at night; the board itself stays under the 1.1 bloom threshold
const BOARD_NIGHT_GAIN = 0.2;

let fontReady: Promise<void> | undefined;
/** Loads Varela Round (Hebrew + Latin subsets). Resolves after at most ~4 s even offline; drawing then falls back. */
export function loadRoundFont(): Promise<void> {
  fontReady ??= (async () => {
    if (!document.querySelector(`link[href="${FONT_URL}"]`)) {
      const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONT_URL });
      const loaded = new Promise<void>((done) => { link.onload = link.onerror = () => done(); });
      document.head.append(link);
      await loaded;
    }
    await Promise.race([document.fonts.load(`64px ${FONT_STACK}`, 'ביה״ס גן הדר David Gan'), new Promise((done) => setTimeout(done, 4000))]);
  })().catch(() => undefined);
  return fontReady;
}

export type SignIcon = 'star' | 'heart' | 'house';
export interface SignStyle { nameHe: string; nameEn: string; color: string; icon: SignIcon }
const FOUND_GREEN = '#2fbf5b';
const INK = '#3b1f5c';

interface Palette { accent: string; board: [top: string, bottom: string] }

/** Frame, icons and board gradient, all derived from the place's color so every place reads as one family. */
function paletteOf(color: string): Palette {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(color).getHSL(hsl, THREE.SRGBColorSpace);
  const shade = (s: number, l: number) => `#${new THREE.Color().setHSL(hsl.h, s, THREE.MathUtils.clamp(l, 0, 0.92), THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace)}`;
  return { accent: shade(hsl.s * 0.95, hsl.l - 0.12), board: [shade(hsl.s, hsl.l + 0.16), shade(hsl.s, hsl.l + 0.04)] };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function heart(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.9);
  ctx.bezierCurveTo(cx - r * 1.4, cy - r * 0.1, cx - r * 0.7, cy - r * 1.2, cx, cy - r * 0.45);
  ctx.bezierCurveTo(cx + r * 0.7, cy - r * 1.2, cx + r * 1.4, cy - r * 0.1, cx, cy + r * 0.9);
  ctx.closePath();
}

function house(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 1.05, cy - r * 0.05);
  ctx.lineTo(cx + r * 0.75, cy - r * 0.05);
  ctx.lineTo(cx + r * 0.75, cy + r * 0.85);
  ctx.lineTo(cx - r * 0.75, cy + r * 0.85);
  ctx.lineTo(cx - r * 0.75, cy - r * 0.05);
  ctx.lineTo(cx - r * 1.05, cy - r * 0.05);
  ctx.closePath();
}

const ICONS: Record<SignIcon, (ctx: CanvasRenderingContext2D, x: number, accent: string) => void> = {
  star(ctx, x, accent) { star(ctx, x, 150, 50); ctx.fillStyle = accent; ctx.fill(); },
  heart(ctx, x, accent) { heart(ctx, x, 158, 48); ctx.fillStyle = accent; ctx.fill(); },
  house(ctx, x, accent) {
    house(ctx, x, 150, 54);
    ctx.fillStyle = accent;
    ctx.fill();
    heart(ctx, x, 172, 19);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  },
};

function fitText(ctx: CanvasRenderingContext2D, text: string, size: number, maxWidth: number) {
  ctx.font = `${size}px ${FONT_STACK}`;
  const w = ctx.measureText(text).width;
  if (w > maxWidth) ctx.font = `${Math.floor((size * maxWidth) / w)}px ${FONT_STACK}`;
}

function draw(ctx: CanvasRenderingContext2D, s: SignStyle, palette: Palette, found: boolean) {
  const accent = found ? FOUND_GREEN : palette.accent;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = accent; // pointer under the board
  ctx.beginPath();
  ctx.moveTo(W / 2 - 60, 420); ctx.lineTo(W / 2 + 60, 420); ctx.lineTo(W / 2, 500); ctx.closePath();
  ctx.fill();

  roundRect(ctx, 20, 20, W - 40, 410, 70);
  ctx.fillStyle = accent;
  ctx.fill();
  const g = ctx.createLinearGradient(0, 40, 0, 410);
  g.addColorStop(0, found ? '#b9f2c6' : palette.board[0]);
  g.addColorStop(1, found ? '#5ccf7c' : palette.board[1]);
  roundRect(ctx, 44, 44, W - 88, 362, 50);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#ffffff';
  roundRect(ctx, 34, 34, W - 68, 382, 58);
  ctx.stroke();

  for (const x of found ? [110] : [110, W - 110]) ICONS[s.icon](ctx, x, accent);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  ctx.fillStyle = INK;
  fitText(ctx, s.nameHe, 160, 660);
  ctx.fillText(s.nameHe, W / 2, 165);

  ctx.direction = 'ltr';
  fitText(ctx, s.nameEn, 92, 860);
  ctx.fillText(s.nameEn, W / 2, 330);

  if (found) {
    const cx = W - 110, cy = 150;
    ctx.beginPath();
    ctx.arc(cx, cy, 70, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 58, 0, Math.PI * 2);
    ctx.fillStyle = FOUND_GREEN;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy + 2); ctx.lineTo(cx - 8, cy + 26); ctx.lineTo(cx + 32, cy - 24);
    ctx.lineWidth = 17; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
}

export interface Sign {
  readonly mesh: THREE.Mesh;
  setFound(found: boolean): void;
  /** At night the board brightens a little and a halo behind it carries the bloom. */
  applyLighting(m: Mood): void;
}

/** Soft additive glow around the board's rounded rect, so the light blooms around the text instead of over it. */
function createHalo(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const w = BOARD.halfW + HALO_MARGIN, h = BOARD.halfH + HALO_MARGIN;
  const material = fxMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uGlow: { value: 0 }, uHalf: { value: new THREE.Vector2(BOARD.halfW, BOARD.halfH) }, uRadius: { value: BOARD.radius } },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uGlow; uniform vec2 uHalf; uniform float uRadius;
      varying vec2 vP;
      void main() {
        vec2 q = abs(vP) - uHalf + uRadius;
        float d = max(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius, 0.0);
        float a = (exp(-d * 1.4) * 0.75 + exp(-d * 0.45) * 0.25) * smoothstep(${HALO_MARGIN.toFixed(1)}, ${(HALO_MARGIN * 0.6).toFixed(1)}, d);
        gl_FragColor = vec4(uColor * a * uGlow, 1.0);
      }`,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, h * 2), material);
  halo.position.set(0, BOARD.y, -0.3);
  halo.renderOrder = 4; // after the beam, before the board
  halo.visible = false;
  return halo;
}

/** Floating name board, 30 x 15 m at scale 1. The bottom tip of its pointer sits at the mesh origin's y - 7.5. */
export function createSign(style: SignStyle): Sign {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const palette = paletteOf(style.color);
  let found = false;
  const redraw = () => { draw(ctx, style, palette, found); texture.needsUpdate = true; };
  redraw();
  void loadRoundFont().then(redraw);

  const material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, transparent: true, side: THREE.DoubleSide, toneMapped: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 15), material);
  const halo = createHalo();
  mesh.add(halo);
  const haloColor = () => {
    const c = halo.material.uniforms.uColor.value as THREE.Color;
    c.set(found ? FOUND_GREEN : palette.accent);
    c.multiplyScalar(HALO_LUMINANCE / luminance(c));
  };
  haloColor();
  return {
    mesh,
    setFound(f) { found = f; redraw(); haloColor(); },
    applyLighting(m) {
      material.color.setScalar(1 + BOARD_NIGHT_GAIN * m.glow);
      halo.material.uniforms.uGlow.value = m.glow;
      halo.visible = lit(m);
    },
  };
}
