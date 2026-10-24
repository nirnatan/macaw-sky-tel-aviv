import * as THREE from 'three';
import type { Mood } from './mood';
import { at, backlitFabric, Parts, seeded, soak } from './parts';

const FLAG_COLORS = ['#ff595e', '#ffca3a', '#1982c4', '#8ac926', '#ffffff', '#ff924c', '#6a4c93', '#ff8fab'];
const BALLOON_COLORS = ['#ff4f6d', '#ffd23f', '#4dd8ff', '#7dff6a', '#b77dff', '#ff9f1c'];

export interface RoofStats {
  center: THREE.Vector2; // point farthest from every edge
  inscribed: number; // radius of the largest circle inside the roof around center
  coverRadius: number; // circle around center that holds ~75% of the roof area
}

function inside(ring: number[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function edgeDistance(ring: number[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[j], az = ring[j + 1], dx = ring[i] - ax, dz = ring[i + 1] - az;
    const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}

export function roofStats(ring: number[]): RoofStats {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]);
    z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]);
  }
  const step = 0.5, samples: [number, number][] = [];
  let center = new THREE.Vector2(), inscribed = 0;
  for (let x = x0; x <= x1; x += step) {
    for (let z = z0; z <= z1; z += step) {
      if (!inside(ring, x, z)) continue;
      samples.push([x, z]);
      const d = edgeDistance(ring, x, z);
      if (d > inscribed) { inscribed = d; center = new THREE.Vector2(x, z); }
    }
  }
  const dists = samples.map(([x, z]) => Math.hypot(x - center.x, z - center.y)).sort((a, b) => a - b);
  return { center, inscribed, coverRadius: dists[Math.floor(dists.length * 0.75)] ?? inscribed };
}

function star(outer: number, inner: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? inner : outer;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

const flat = (g: THREE.BufferGeometry) => g.rotateX(-Math.PI / 2);

function addBunting(p: Parts, ring: number[], roof: number) {
  const POST = 1.9, SAG = 0.4, FLAG_W = 0.55, FLAG_H = 0.75, GAP = 0.2;
  let k = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const a = new THREE.Vector3(ring[i], roof, ring[i + 1]);
    const b = new THREE.Vector3(ring[(i + 2) % ring.length], roof, ring[(i + 3) % ring.length]);
    const len = a.distanceTo(b);
    const spans = Math.max(1, Math.ceil(len / 14));
    for (let s = 0; s < spans; s++) {
      const p0 = a.clone().lerp(b, s / spans), p1 = a.clone().lerp(b, (s + 1) / spans);
      p.beam(p0, p0.clone().setY(roof + POST), 0.09, '#ffffff');
      const spanLen = p0.distanceTo(p1);
      const stringAt = (t: number) => p0.clone().lerp(p1, t).setY(roof + POST - SAG * 4 * t * (1 - t));
      const segs = 8;
      for (let j = 0; j < segs; j++) p.beam(stringAt(j / segs), stringAt((j + 1) / segs), 0.025, '#f5f5f5');
      const n = Math.floor(spanLen / (FLAG_W + GAP));
      for (let f = 0; f < n; f++) {
        const t0 = (f * (FLAG_W + GAP) + GAP) / spanLen, t1 = t0 + FLAG_W / spanLen;
        const l = stringAt(t0), r = stringAt(t1);
        const tip = l.clone().add(r).multiplyScalar(0.5).add(new THREE.Vector3(0, -FLAG_H, 0));
        const g = new THREE.BufferGeometry().setFromPoints([l, r, tip]);
        g.computeVertexNormals();
        p.add(g, FLAG_COLORS[k++ % FLAG_COLORS.length]);
      }
    }
  }
}

export interface SchoolDecor {
  readonly objects: THREE.Object3D[];
  update(time: number): void;
  applyLighting(m: Mood): void;
}

const DECOR_ROUGHNESS = 0.7;

export function createSchoolDecor(ring: number[], roof: number, stats: RoofStats, castShadow: boolean): SchoolDecor {
  const R = Math.min(stats.inscribed * 0.92, 12);
  const { x: cx, y: cz } = stats.center;

  const decor = new Parts();
  decor.add(flat(new THREE.CircleGeometry(R, 64)), '#24418f', at(cx, roof + 0.12, cz));
  decor.add(flat(new THREE.RingGeometry(R * 0.95, R * 0.99, 64)), '#ffffff', at(cx, roof + 0.14, cz));
  addBunting(decor, ring, roof);
  const fabric = backlitFabric(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: DECOR_ROUGHNESS, side: THREE.DoubleSide }), 0.3);
  const decorMesh = new THREE.Mesh(decor.build(), fabric.material);
  decorMesh.castShadow = castShadow;
  decorMesh.receiveShadow = true;

  const glow = new Parts();
  glow.add(flat(new THREE.RingGeometry(R * 0.8, R * 0.9, 72)), '#ffffff', at(cx, roof + 0.16, cz));
  glow.add(flat(new THREE.ShapeGeometry(star(R * 0.62, R * 0.26))), '#ffffff', at(cx, roof + 0.16, cz));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    glow.add(flat(new THREE.CircleGeometry(R * 0.035, 12)), '#ffffff', at(cx + Math.cos(a) * R * 0.71, roof + 0.16, cz + Math.sin(a) * R * 0.71));
  }
  const glowMat = new THREE.MeshStandardMaterial({ color: '#ffcf40', emissive: '#ffb300', emissiveIntensity: 1.4, metalness: 0.3, roughness: 0.35 });
  const glowMesh = new THREE.Mesh(glow.build(), glowMat);

  const balloons = createBalloons(ring, roof, stats.center);
  let starBoost = 1;
  return {
    objects: [decorMesh, glowMesh, balloons.mesh],
    applyLighting(m) {
      fabric.setDaylight(m.daylight);
      soak(fabric.material, DECOR_ROUGHNESS, m.wet);
      starBoost = 1 + 0.8 * m.glow;
    },
    update(time) {
      glowMat.emissiveIntensity = (1.2 + 0.4 * Math.sin(time * 2.2)) * starBoost;
      balloons.time.value = time;
    },
  };
}

/** Clusters of party balloons on the roof corners farthest from the pad, swaying in the breeze. */
function createBalloons(ring: number[], roof: number, center: THREE.Vector2) {
  const rand = seeded(11);
  const corners: THREE.Vector2[] = [];
  for (let i = 0; i < ring.length; i += 2) corners.push(new THREE.Vector2(ring[i], ring[i + 1]));
  corners.sort((a, b) => b.distanceTo(center) - a.distanceTo(center));
  const anchors: THREE.Vector2[] = [];
  for (const c of corners) if (anchors.length < 3 && anchors.every((a) => a.distanceTo(c) > 20)) anchors.push(c);

  const p = new Parts();
  anchors.forEach((c, ci) => {
    const base = c.clone().lerp(center, 2 / c.distanceTo(center));
    const knot = new THREE.Vector3(base.x, roof + 0.3, base.y);
    p.add(new THREE.CylinderGeometry(0.15, 0.2, 0.3, 8), '#ffffff', at(knot.x, roof + 0.15, knot.z));
    for (let b = 0; b < 7; b++) {
      const a = (b / 7) * Math.PI * 2 + ci;
      const top = new THREE.Vector3(base.x + Math.cos(a) * (0.6 + rand() * 0.5), roof + 3.2 + rand() * 1.6, base.y + Math.sin(a) * (0.6 + rand() * 0.5));
      p.beam(knot, top, 0.02, '#ffffff');
      p.add(new THREE.SphereGeometry(0.55, 14, 10), BALLOON_COLORS[(b + ci) % BALLOON_COLORS.length], at(top.x, top.y + 0.62, top.z, undefined, new THREE.Vector3(1, 1.2, 1)));
      p.add(new THREE.ConeGeometry(0.1, 0.16, 6), BALLOON_COLORS[(b + ci) % BALLOON_COLORS.length], at(top.x, top.y + 0.04, top.z));
    }
  });
  const time = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.05 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float lift = max(transformed.y - ${(roof + 0.3).toFixed(2)}, 0.0);
        float phase = transformed.x * 0.15 + transformed.z * 0.1;
        transformed.x += sin(uTime * 1.3 + phase) * lift * 0.07;
        transformed.z += cos(uTime * 1.1 + phase) * lift * 0.05;`);
  };
  const mesh = new THREE.Mesh(p.build(), mat);
  return { mesh, time };
}
