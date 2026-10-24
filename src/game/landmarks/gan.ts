import * as THREE from 'three';
import type { Surface } from '../../contracts';
import type { CityData } from '../../world/data';
import { ATLAS, createGanAtlas, WALL_COLOR } from './gan-art';
import { fxMaterial } from './fx';
import { lit, type Mood } from './mood';
import { at, backlitFabric, Parts, seeded, soak } from './parts';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// Local frame: +Z faces the street, x/z in meters from the compound center. The house sits at the back-left,
// the playground fills the right side under shade sails, the front-left has the gate path, a bench and a tree.
const YARD = { halfX: 13, halfZ: 9 };
const HOUSE = { x0: -12.5, x1: 1.5, z0: -8.5, z1: 1.5, roof: 4.0, overhang: 0.25 };
const SANDBOX = { x: 4.8, z: 5.6, half: 1.4, top: 0.22 };
const YARD_TOP = 0.06;
const GATE = { x0: -3, x1: -1 };
const RAIL_TOP = 0.85;
const ROUGHNESS = 0.85;
const SAILS: [THREE.Vector3[], string][] = [
  [[V(2.4, 4.3, -8.6), V(12.6, 3.4, -8.6), V(12.6, 4.3, -1.0), V(2.4, 3.4, -1.0)], '#2ec4b6'],
  [[V(2.6, 4.2, 0.2), V(12.6, 3.4, 0.2), V(7.6, 4.0, 8.6)], '#ffcf4a'],
  [[V(2.6, 3.5, 8.6), V(12.6, 4.4, 8.6), V(7.6, 3.6, 1.0)], '#ff8fab'],
];
const FAIRY_COLORS = ['#ffd27a', '#ff8fab', '#8fe3cf', '#a0c4ff', '#ffe9a8', '#cdb4db'];
const WINDOW_TINT = new THREE.Color('#ffc46b').multiplyScalar(2.4); // warm lamplight, over the 1.1 bloom threshold
const POOL_TINT = new THREE.Color('#ffb15a').multiplyScalar(0.45);

export const GAN_ROOF_CENTER = new THREE.Vector3((HOUSE.x0 + HOUSE.x1) / 2, HOUSE.roof, (HOUSE.z0 + HOUSE.z1) / 2);
export const GAN_ROOF_RADIUS = 7.5;
export const GAN_PAD_RADIUS = 4.4;

const PASTELS = ['#ff8fab', '#ffd166', '#8fe3cf', '#a0c4ff', '#cdb4db'];

/** Aligns the compound with the nearest street and pushes it back so the front fence sits on the sidewalk. */
function ganPlacement(data: CityData): { center: THREE.Vector3; yaw: number } {
  const { x, z } = data.targets.gan;
  let best = { d: 40, nx: 0, nz: 1, half: 0 };
  for (const road of data.roads) {
    if (road.kind === 'footway' || road.kind === 'rail' || road.kind === 'service') continue;
    const p = road.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az;
      const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      const cx = ax + dx * t - x, cz = az + dz * t - z;
      const d = Math.hypot(cx, cz);
      if (d < best.d && d > 0.1) best = { d, nx: cx / d, nz: cz / d, half: road.width / 2 };
    }
  }
  const push = Math.max(0, best.half + 1.5 + YARD.halfZ - best.d);
  return { center: V(x - best.nx * push, 0, z - best.nz * push), yaw: Math.atan2(best.nx, best.nz) };
}

/** Orders a triangle so its front face looks up; seen from below it shows the backlit side. */
function upward(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Vector3[] {
  const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
  return ny >= 0 ? [a, b, c] : [a, c, b];
}

function sail(corners: THREE.Vector3[], sag: number): THREE.BufferGeometry {
  const n = 8, pts: THREE.Vector3[] = [];
  const pointAt = (u: number, v: number) => {
    if (corners.length === 4) {
      const a = corners[0].clone().lerp(corners[1], u), b = corners[3].clone().lerp(corners[2], u);
      return a.lerp(b, v).setY(a.y - sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
    }
    const w = 1 - u - v;
    return corners[0].clone().multiplyScalar(w).addScaledVector(corners[1], u).addScaledVector(corners[2], v).add(V(0, -sag * 27 * u * v * w, 0));
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const u0 = i / n, u1 = (i + 1) / n, v0 = j / n, v1 = (j + 1) / n;
      if (corners.length === 3 && u0 + v0 >= 1) continue;
      const a = pointAt(u0, v0), b = pointAt(u1, v0), c = pointAt(u0, v1);
      pts.push(...upward(a, b, c));
      if (corners.length === 4 || u1 + v1 <= 1 + 1e-6) pts.push(...upward(b, pointAt(u1, v1), c));
    }
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  g.computeVertexNormals();
  return g;
}

/** A window's outward-facing glass center and its yaw. */
interface WindowPose { center: THREE.Vector3; ry: number }

function addHouse(p: Parts, windows: WindowPose[]) {
  const { x0, x1, z0, z1, roof, overhang } = HOUSE;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  const wallTop = roof - 0.3;
  p.box(w, wallTop, d, WALL_COLOR, cx, wallTop / 2, cz);
  p.box(w + 0.06, 0.25, d + 0.06, '#a8e6cf', cx, 0.125, cz);
  p.box(w + overhang * 2, 0.3, d + overhang * 2, '#fff7ee', cx, roof - 0.15, cz);
  const pw = w + overhang * 2, pd = d + overhang * 2;
  for (const [sx, sz, bw, bd] of [[0, pd / 2, pw, 0.25], [0, -pd / 2, pw, 0.25], [pw / 2, 0, 0.25, pd], [-pw / 2, 0, 0.25, pd]]) {
    p.box(bw, 0.35, bd, '#ff9fbf', cx + sx - Math.sign(sx) * 0.125, roof + 0.175, cz + sz - Math.sign(sz) * 0.125);
  }
  const muralH = wallTop - 0.25;
  p.add(new THREE.PlaneGeometry(pw - 0.6, pd - 0.6).rotateX(-Math.PI / 2), '#ffffff', at(cx, roof + 0.01, cz), ATLAS.roof);
  p.add(new THREE.PlaneGeometry(w, muralH), '#ffffff', at(cx, 0.25 + muralH / 2, z1 + 0.015), ATLAS.front);
  p.add(new THREE.PlaneGeometry(d, muralH).rotateY(Math.PI / 2), '#ffffff', at(x1 + 0.015, 0.25 + muralH / 2, cz), ATLAS.side);

  p.box(1.75, 2.45, 0.08, '#ffffff', -2, 1.225, z1 + 0.03);
  p.box(1.5, 2.3, 0.12, '#3cc8c8', -2, 1.15, z1 + 0.06);
  p.box(0.5, 0.6, 0.14, '#bfefff', -2, 1.7, z1 + 0.07);
  p.add(new THREE.SphereGeometry(0.06, 6, 4), '#ffd23f', at(-1.45, 1.1, z1 + 0.14));
  p.box(2.0, 0.15, 0.7, '#e7e1d8', -2, 0.075, z1 + 0.35);
  for (let i = 0; i < 5; i++) p.box(0.46, 0.05, 1.0, i % 2 ? '#ffffff' : '#ff6b6b', -2.92 + i * 0.46, 2.55, z1 + 0.45, new THREE.Euler(0.38, 0, 0));

  const windowAt = (x: number, z: number, ry: number) => {
    const rot = new THREE.Euler(0, ry, 0);
    const out = V(Math.sin(ry), 0, Math.cos(ry));
    const pos = (o: number, y: number) => V(x + out.x * o, y, z + out.z * o);
    const f = pos(0.04, 1.75), g = pos(0.08, 1.75), b = pos(0.2, 0.98);
    p.box(1.5, 1.35, 0.08, '#ffffff', f.x, f.y, f.z, rot);
    p.box(1.3, 1.15, 0.06, '#9ed8f5', g.x, g.y, g.z, rot);
    windows.push({ center: pos(0.12, 1.75), ry });
    p.box(1.5, 0.22, 0.3, '#d9774b', b.x, b.y, b.z, rot);
    for (let k = 0; k < 4; k++) {
      const s = pos(0.22, 1.15).add(V(Math.cos(ry), 0, -Math.sin(ry)).multiplyScalar(-0.54 + k * 0.36));
      p.add(new THREE.IcosahedronGeometry(0.15, 0), PASTELS[(k + Math.round(x)) % PASTELS.length], at(s.x, s.y, s.z));
    }
  };
  windowAt(x1, -3, Math.PI / 2);
  windowAt(x1, -6.3, Math.PI / 2);
  for (const x of [-11, -8, -5, -2]) windowAt(x, z0, Math.PI);
  for (const z of [-6, -1.5]) windowAt(x0, z, -Math.PI / 2);

  // Solar water heater, on every Israeli roof.
  const hx = x0 + 1.3, hz = z0 + 0.9;
  p.add(new THREE.CylinderGeometry(0.33, 0.33, 1.6, 12).rotateZ(Math.PI / 2), '#f4f4f4', at(hx, roof + 1.05, hz - 0.35));
  p.box(1.6, 0.06, 1.1, '#203a6b', hx, roof + 0.55, hz + 0.45, new THREE.Euler(-0.6, 0, 0));
  for (const dx of [-0.7, 0.7]) p.beam(V(hx + dx, roof, hz - 0.35), V(hx + dx, roof + 0.75, hz - 0.35), 0.06, '#9aa5b1');
}

function addFence(p: Parts) {
  const { halfX: hx, halfZ: hz } = YARD;
  const sides: [THREE.Vector3, THREE.Vector3][] = [[V(-hx, 0, hz), V(hx, 0, hz)], [V(hx, 0, hz), V(hx, 0, -hz)], [V(hx, 0, -hz), V(-hx, 0, -hz)], [V(-hx, 0, -hz), V(-hx, 0, hz)]];
  let k = 0;
  sides.forEach(([a, b], side) => {
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const ry = Math.atan2(dir.x, dir.z) + Math.PI / 2;
    for (let s = 0.15; s < len; s += 0.3) {
      const q = a.clone().addScaledVector(dir, s);
      if (side === 0 && q.x > GATE.x0 && q.x < GATE.x1) continue;
      p.box(0.1, 1.0, 0.05, PASTELS[k++ % PASTELS.length], q.x, 0.56, q.z, new THREE.Euler(0, ry, 0));
    }
    for (const y of [0.35, RAIL_TOP]) {
      if (side === 0) {
        p.beam(V(-hx, y, hz - 0.05), V(GATE.x0, y, hz - 0.05), 0.06, '#ffffff');
        p.beam(V(GATE.x1, y, hz - 0.05), V(hx, y, hz - 0.05), 0.06, '#ffffff');
      } else {
        p.beam(a.clone().setY(y), b.clone().setY(y), 0.06, '#ffffff');
      }
    }
  });
  for (const gx of [GATE.x0, GATE.x1]) {
    p.add(new THREE.CylinderGeometry(0.1, 0.1, 1.4, 8), '#ff8fab', at(gx, 0.7, hz));
    for (let b = 0; b < 3; b++) {
      const top = V(gx + (b - 1) * 0.35, 2.1 + (b % 2) * 0.35, hz + (b - 1) * 0.12);
      p.beam(V(gx, 1.4, hz), top, 0.015, '#ffffff');
      p.add(new THREE.SphereGeometry(0.28, 10, 8), ['#ff595e', '#ffca3a', '#1982c4'][b], at(top.x, top.y + 0.3, top.z, undefined, V(1, 1.18, 1)));
    }
  }
}

function addPlayground(p: Parts) {
  p.box(9.8, 0.02, 8.4, '#5fb4e8', 7.6, 0.07, -4.6);
  p.box(9.8, 0.02, 8.2, '#ffb08a', 7.6, 0.07, 4.6);
  p.box(1.6, 0.02, 7.4, '#f3e3c3', -2, 0.075, 5.2);

  const sx = 4.6, sz = -6.4, deck = 1.5;
  p.box(1.4, 0.12, 1.4, '#ffd23f', sx, deck, sz);
  for (const [dx, dz] of [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]]) p.beam(V(sx + dx, 0, sz + dz), V(sx + dx, 2.7, sz + dz), 0.1, '#3a86ff');
  p.add(new THREE.ConeGeometry(1.15, 0.8, 4).rotateY(Math.PI / 4), '#ff595e', at(sx, 3.1, sz));
  for (const dz of [-0.4, 0.4]) p.beam(V(sx - 1.3, 0, sz + dz), V(sx - 0.7, deck, sz + dz), 0.07, '#3a86ff');
  for (let r = 1; r <= 4; r++) {
    const t = r / 5;
    p.beam(V(sx - 1.3 + 0.6 * t, deck * t, sz - 0.4), V(sx - 1.3 + 0.6 * t, deck * t, sz + 0.4), 0.05, '#ffffff');
  }
  const start = V(sx + 0.7, deck + 0.05, sz), end = V(sx + 4.1, 0.3, sz);
  const slope = Math.atan2(end.y - start.y, end.x - start.x);
  const mid = start.clone().add(end).multiplyScalar(0.5);
  p.box(start.distanceTo(end), 0.06, 0.8, '#ff595e', mid.x, mid.y, mid.z, new THREE.Euler(0, 0, slope));
  for (const dz of [-0.42, 0.42]) p.box(start.distanceTo(end), 0.22, 0.05, '#ff924c', mid.x, mid.y + 0.1, mid.z + dz, new THREE.Euler(0, 0, slope));
  p.box(0.7, 0.06, 0.8, '#ff595e', end.x + 0.33, 0.28, sz);

  const wz = 3.6, w0 = 8.2, w1 = 12.0, top = 2.4;
  p.beam(V(w0, top, wz), V(w1, top, wz), 0.14, '#3a86ff');
  for (const x of [w0, w1]) for (const dz of [-1, 1]) p.beam(V(x, top, wz), V(x, 0, wz + dz), 0.12, '#3a86ff');
  [9.4, 10.8].forEach((x, i) => {
    for (const dx of [-0.24, 0.24]) p.beam(V(x + dx, top, wz), V(x + dx, 0.55, wz), 0.025, '#9aa5b1');
    p.box(0.6, 0.06, 0.3, i ? '#ffca3a' : '#ff595e', x, 0.52, wz);
  });

  const { x: bx, z: bz, half } = SANDBOX;
  p.box(half * 2, 0.2, half * 2, '#f2d59b', bx, 0.12, bz);
  for (const [dx, dz, w, d] of [[0, half, half * 2 + 0.2, 0.18], [0, -half, half * 2 + 0.2, 0.18], [half, 0, 0.18, half * 2], [-half, 0, 0.18, half * 2]]) {
    p.box(w, 0.32, d, '#c98b4f', bx + dx, 0.16, bz + dz);
  }
  p.add(new THREE.CylinderGeometry(0.16, 0.12, 0.26, 10), '#ff595e', at(bx - 0.6, 0.35, bz - 0.5));
  p.box(0.08, 0.02, 0.5, '#3a86ff', bx - 0.2, 0.24, bz - 0.7, new THREE.Euler(0, 0.6, 0));
  p.box(0.5, 0.3, 0.5, '#e8c483', bx + 0.4, 0.37, bz + 0.3);
  p.add(new THREE.ConeGeometry(0.2, 0.3, 6), '#e8c483', at(bx + 0.4, 0.67, bz + 0.3));

  const poles = new Map<string, THREE.Vector3>();
  for (const [corners, color] of SAILS) {
    p.add(sail(corners, 0.25), color);
    for (const c of corners) {
      const key = `${c.x.toFixed(1)},${c.z.toFixed(1)}`;
      if (!poles.has(key) || poles.get(key)!.y < c.y) poles.set(key, c);
    }
  }
  for (const c of poles.values()) p.beam(V(c.x, 0, c.z), V(c.x, c.y + 0.15, c.z), 0.12, '#8a99a6');
}

function addGarden(p: Parts) {
  p.add(new THREE.CylinderGeometry(0.16, 0.22, 2.4, 8), '#8b5a2b', at(-11, 1.2, 7.0));
  for (const [dx, y, dz, r, c] of [[0, 3.2, 0, 1.5, '#4caf50'], [0.8, 2.7, 0.5, 1.1, '#5cbf60'], [-0.7, 2.8, -0.4, 1.1, '#43a047']] as const) {
    p.add(new THREE.IcosahedronGeometry(r, 1), c, at(-11 + dx, y, 7.0 + dz));
  }
  p.box(1.8, 0.08, 0.45, '#ff9f1c', -6.5, 0.45, 8.1);
  for (const dx of [-0.75, 0.75]) p.box(0.08, 0.45, 0.4, '#8b5a2b', -6.5 + dx, 0.22, 8.1);
  for (const [x, c] of [[-10.5, '#ff595e'], [-8.0, '#ffca3a'], [-5.2, '#6a4c93'], [0.4, '#ff8fab']] as const) {
    p.add(new THREE.CylinderGeometry(0.28, 0.2, 0.45, 10), '#d9774b', at(x, 0.23, HOUSE.z1 + 0.45));
    p.add(new THREE.IcosahedronGeometry(0.3, 1), '#4caf50', at(x, 0.6, HOUSE.z1 + 0.45));
    for (let k = 0; k < 3; k++) p.add(new THREE.IcosahedronGeometry(0.1, 0), c, at(x + Math.cos(k * 2.1) * 0.22, 0.78, HOUSE.z1 + 0.45 + Math.sin(k * 2.1) * 0.22));
  }
}

/** Lit windows, the door window and a pool of light on the path; one additive mesh. */
function windowGlow(windows: WindowPose[]): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const pos: number[] = [], uv: number[] = [], tint: number[] = [], kind: number[] = [];
  const quad = (c: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, w: number, h: number, color: THREE.Color, k: number) => {
    const corner = (u: number, v: number) => {
      const p = c.clone().addScaledVector(right, (u - 0.5) * w).addScaledVector(up, (v - 0.5) * h);
      pos.push(p.x, p.y, p.z);
      uv.push(u, v);
      tint.push(color.r, color.g, color.b);
      kind.push(k);
    };
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) corner(u, v);
  };
  const up = V(0, 1, 0);
  for (const { center, ry } of windows) quad(center, V(Math.cos(ry), 0, -Math.sin(ry)), up, 1.26, 1.1, WINDOW_TINT, 0);
  quad(V(-2, 1.7, HOUSE.z1 + 0.15), V(1, 0, 0), up, 0.46, 0.56, WINDOW_TINT, 0);
  quad(V(-2, 0.1, HOUSE.z1 + 1.6), V(1, 0, 0), V(0, 0, 1), 3.8, 3.2, POOL_TINT, 1);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  const material = fxMaterial({
    side: THREE.DoubleSide,
    uniforms: { uGlow: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aTint; attribute float aKind;
      varying vec2 vUv; varying vec3 vTint; varying float vKind;
      void main() { vUv = uv; vTint = aTint; vKind = aKind; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uGlow;
      varying vec2 vUv; varying vec3 vTint; varying float vKind;
      void main() {
        vec2 e = min(vUv, 1.0 - vUv);
        float pane = smoothstep(0.0, 0.08, min(e.x, e.y)) * mix(1.15, 0.8, vUv.y);
        pane *= 1.0 - 0.55 * (1.0 - smoothstep(0.02, 0.04, abs(vUv.x - 0.5))); // mullions
        pane *= 1.0 - 0.55 * (1.0 - smoothstep(0.02, 0.04, abs(vUv.y - 0.55)));
        float pool = pow(max(1.0 - length(vUv - 0.5) * 2.0, 0.0), 2.0);
        gl_FragColor = vec4(vTint * mix(pane, pool, vKind) * uGlow, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.renderOrder = 2;
  return mesh;
}

/** Fairy lights along the fence's top rail and the sail edges, plus the lamp by the door. */
function fairyLights(): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const rand = seeded(23);
  const pos: number[] = [], color: number[] = [], bulb: number[] = [];
  const palette = FAIRY_COLORS.map((c) => new THREE.Color(c));
  const add = (p: THREE.Vector3, c: THREE.Color, size: number) => {
    pos.push(p.x, p.y, p.z);
    color.push(c.r, c.g, c.b);
    bulb.push(size, rand() * 6.28);
  };
  const string = (a: THREE.Vector3, b: THREE.Vector3, gap: number, droop: number) => {
    const n = Math.max(1, Math.round(a.distanceTo(b) / gap));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      add(a.clone().lerp(b, t).add(V(0, -droop * Math.abs(Math.sin(t * n * Math.PI * 0.5)), 0)), palette[bulb.length / 2 % palette.length], 0.42);
    }
  };
  const { halfX: hx, halfZ: hz } = YARD;
  const y = RAIL_TOP + 0.07;
  string(V(-hx, y, hz - 0.05), V(GATE.x0, y, hz - 0.05), 0.55, 0.05);
  string(V(GATE.x1, y, hz - 0.05), V(hx, y, hz - 0.05), 0.55, 0.05);
  string(V(hx, y, hz), V(hx, y, -hz), 0.55, 0.05);
  string(V(hx, y, -hz), V(-hx, y, -hz), 0.55, 0.05);
  string(V(-hx, y, -hz), V(-hx, y, hz), 0.55, 0.05);
  for (const [corners] of SAILS) corners.forEach((c, i) => string(c, corners[(i + 1) % corners.length], 0.6, 0));
  add(V(-0.85, 2.05, HOUSE.z1 + 0.2), new THREE.Color('#ffe2a8'), 0.9);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(color, 3));
  g.setAttribute('aBulb', new THREE.Float32BufferAttribute(bulb, 2));
  const material = fxMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uGlow: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute vec2 aBulb; // size in meters, twinkle phase
      uniform float uTime; uniform float uScale; uniform float uGlow;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(2.0, uScale * aBulb.x / -mv.z);
        vAlpha = uGlow * (0.7 + 0.3 * sin(uTime * 2.3 + aBulb.y));
        vColor = aColor;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d);
        vec3 c = vColor * exp(-r2 * 14.0) * 0.5 + mix(vColor, vec3(1.0), 0.6) * exp(-r2 * 70.0);
        gl_FragColor = vec4(c * vAlpha * 2.2, 1.0);
      }`,
  });
  const points = new THREE.Points(g, material);
  points.renderOrder = 2;
  return points;
}

export interface Gan {
  readonly group: THREE.Group;
  surfaceAt(x: number, z: number, belowY: number): Surface | null;
  applyLighting(m: Mood): void;
  /** `pointScale` turns the fairy lights' size in meters into pixels. */
  update(time: number, pointScale: number): void;
}

export function createGan(data: CityData, castShadow: boolean): Gan {
  const { center, yaw } = ganPlacement(data);
  const p = new Parts(ATLAS.blank);
  const windows: WindowPose[] = [];
  p.box(YARD.halfX * 2, YARD_TOP, YARD.halfZ * 2, '#8fd16a', 0, YARD_TOP / 2, 0);
  addHouse(p, windows);
  addFence(p);
  addPlayground(p);
  addGarden(p);
  const fabric = backlitFabric(new THREE.MeshStandardMaterial({ map: createGanAtlas(), vertexColors: true, roughness: ROUGHNESS, side: THREE.DoubleSide }), 0.22);
  const mesh = new THREE.Mesh(p.build(), fabric.material);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  const glow = windowGlow(windows);
  const fairy = fairyLights();

  const group = new THREE.Group();
  group.name = 'gan';
  group.position.copy(center);
  group.rotation.y = yaw;
  group.add(mesh, glow, fairy);
  group.updateMatrixWorld(true);
  const toLocal = group.matrixWorld.clone().invert();
  const local = new THREE.Vector3();

  return {
    group,
    surfaceAt(x, z, belowY) {
      local.set(x, 0, z).applyMatrix4(toLocal);
      const { x: lx, z: lz } = local;
      if (Math.abs(lx) > YARD.halfX || Math.abs(lz) > YARD.halfZ) return null;
      const o = HOUSE.overhang;
      if (lx >= HOUSE.x0 - o && lx <= HOUSE.x1 + o && lz >= HOUSE.z0 - o && lz <= HOUSE.z1 + o && belowY >= HOUSE.roof) return { height: HOUSE.roof, kind: 'roof' };
      if (Math.abs(lx - SANDBOX.x) < SANDBOX.half && Math.abs(lz - SANDBOX.z) < SANDBOX.half && belowY >= SANDBOX.top) return { height: SANDBOX.top, kind: 'beach' };
      return belowY >= YARD_TOP ? { height: YARD_TOP, kind: 'park' } : null;
    },
    applyLighting(m) {
      fabric.setDaylight(m.daylight);
      soak(fabric.material, ROUGHNESS, m.wet);
      glow.visible = fairy.visible = lit(m);
      glow.material.uniforms.uGlow.value = fairy.material.uniforms.uGlow.value = m.glow;
    },
    update(time, pointScale) {
      fairy.material.uniforms.uTime.value = time;
      fairy.material.uniforms.uScale.value = pointScale;
    },
  };
}
