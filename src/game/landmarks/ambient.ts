import * as THREE from 'three';
import type { CityData, Ring } from '../../world/data';
import type { Quality } from '../../contracts';
import { fxMaterial } from './fx';
import { lit, type Mood } from './mood';
import { at, backlitFabric, Parts, seeded, soak } from './parts';

export interface Ambient {
  readonly objects: THREE.Object3D[];
  applyLighting(m: Mood): void;
  /** `pointScale` turns lantern sizes in meters into pixels. */
  update(dt: number, time: number, bird: THREE.Vector3, pointScale: number): void;
}

const BOAT_ROUGHNESS = 0.6;
const ROOST_Z = 60; // on the sand just north of the Gordon beach start, far from both landing spots
const ROOST_UP_BEACH = 22; // meters inland from the waterline, inside the 38 m sand strip
const SPOOK_RADIUS = 9;

/** Burner pulses, a function of time and the balloon's world x so the two balloons fire out of step. */
const BURNER_GLSL = /* glsl */ `
float burner(float t, float x) { return 0.3 + 0.7 * smoothstep(0.4, 0.95, sin(t * 0.7 + x * 0.002)); }`;

const LAMP = { bulb: 0, reflection: 1, flame: 2 } as const;
/** A night light in its carrier's local frame (boat or balloon). Size is in meters. */
interface Lamp { at: THREE.Vector3; color: THREE.Color; size: number; kind: (typeof LAMP)[keyof typeof LAMP] }

/** Westmost x where the coastline crosses latitude line z (the sea is west of it). */
function coastX(coast: Ring, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 3 < coast.length; i += 2) {
    const z0 = coast[i + 1], z1 = coast[i + 3];
    if ((z0 - z) * (z1 - z) > 0 || z0 === z1) continue;
    best = Math.min(best, coast[i] + ((coast[i + 2] - coast[i]) * (z - z0)) / (z1 - z0));
  }
  return Number.isFinite(best) ? best : -3300;
}

function hullShape(length: number, beam: number): THREE.Shape {
  const l = length / 2, b = beam / 2;
  const s = new THREE.Shape();
  s.moveTo(0, l);
  s.quadraticCurveTo(b * 1.05, l * 0.55, b, -l * 0.55);
  s.lineTo(b * 0.8, -l);
  s.lineTo(-b * 0.8, -l);
  s.lineTo(-b, -l * 0.55);
  s.quadraticCurveTo(-b * 1.05, l * 0.55, 0, l);
  return s;
}

/** Hull slab from y0 to y1, bow toward +Z. */
function hullSlab(length: number, beam: number, y0: number, y1: number): THREE.BufferGeometry {
  return new THREE.ExtrudeGeometry(hullShape(length, beam), { depth: y1 - y0, bevelEnabled: false, curveSegments: 6 })
    .rotateX(Math.PI / 2)
    .translate(0, y1, 0);
}

function triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry().setFromPoints([a, b, c]);
  g.computeVertexNormals();
  return g;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const STRING_COLORS = ['#ffd27a', '#ff8fab', '#8fe3cf', '#a0c4ff', '#ffe9a8'].map((c) => new THREE.Color(c));
const LANTERN = new THREE.Color('#ffb347');
const MASTHEAD = new THREE.Color('#fff1c9');

function lampString(out: Lamp[], a: THREE.Vector3, b: THREE.Vector3, count: number) {
  for (let i = 0; i < count; i++) out.push({ at: a.clone().lerp(b, (i + 0.5) / count), color: STRING_COLORS[i % STRING_COLORS.length], size: 0.5, kind: LAMP.bulb });
}

/** Stern lantern with its shimmer on the water, a masthead light and bulb strings down the stays. */
function boatLamps(mastTop: THREE.Vector3, bow: THREE.Vector3, stern: THREE.Vector3, extra: Lamp[] = []): Lamp[] {
  const lamps: Lamp[] = [
    { at: mastTop, color: MASTHEAD, size: 0.8, kind: LAMP.bulb },
    { at: stern, color: LANTERN, size: 1.4, kind: LAMP.bulb },
    { at: stern.clone().setY(0.08), color: LANTERN, size: 16, kind: LAMP.reflection },
    { at: mastTop.clone().setY(0.08), color: MASTHEAD, size: 22, kind: LAMP.reflection },
    ...extra,
  ];
  lampString(lamps, mastTop, bow, 7);
  lampString(lamps, mastTop, stern, 7);
  return lamps;
}

function sailboat(hull: string, stripe: string, jib: string): THREE.BufferGeometry {
  const p = new Parts();
  p.add(hullSlab(9, 2.7, -0.35, 0.35), hull);
  p.add(hullSlab(9.1, 2.75, 0.35, 0.5), stripe);
  p.add(hullSlab(9, 2.7, 0.5, 0.9), '#fbfbf7');
  p.box(1.5, 0.6, 2.6, '#f4efe4', 0, 1.2, -0.8);
  p.add(new THREE.CylinderGeometry(0.07, 0.09, 12.5, 6), '#d9d9d9', at(0, 7.1, 1.0));
  p.beam(V(0, 1.7, 1.0), V(0, 1.7, -3.6), 0.12, '#d9d9d9');
  p.add(triangle(V(0, 1.8, 1.0), V(0, 12.6, 1.0), V(0, 1.8, -3.5)), '#fffdf7');
  p.add(triangle(V(0, 11.6, 1.05), V(0, 1.1, 4.3), V(0, 1.3, 1.1)), jib);
  return p.build();
}

function fishingBoat(): THREE.BufferGeometry {
  const p = new Parts();
  p.add(hullSlab(8.5, 3.2, -0.5, 0.4), '#d6402f');
  p.add(hullSlab(8.6, 3.25, 0.4, 0.6), '#ffffff');
  p.add(hullSlab(8.5, 3.2, 0.6, 1.1), '#2f6fb3');
  p.box(2.0, 1.7, 2.0, '#ffffff', 0, 1.95, 0.4);
  p.box(2.2, 0.15, 2.3, '#2f6fb3', 0, 2.85, 0.4);
  p.box(1.6, 0.5, 0.05, '#9fd8ff', 0, 2.2, 1.42);
  p.add(new THREE.CylinderGeometry(0.07, 0.07, 4.5, 6), '#e8e0c8', at(0, 3.2, -2.4));
  p.beam(V(0, 5.2, -2.4), V(0, 1.2, 3.8), 0.04, '#333333');
  p.beam(V(0, 4.0, -2.4), V(1.6, 1.0, -3.8), 0.04, '#333333');
  for (const [x, z, c] of [[1.2, -2.8, '#ff8a1c'], [-1.1, -3.1, '#ffd23f'], [-1.2, 2.2, '#ff8a1c']] as const) {
    p.add(new THREE.SphereGeometry(0.28, 8, 6), c, at(x, 1.35, z));
  }
  return p.build();
}

interface Boat { mesh: THREE.Mesh; cx: number; cz: number; rx: number; rz: number; speed: number; phase: number; lamps: Lamp[] }

const SAILBOAT_LAMPS = boatLamps(V(0, 12.9, 1.0), V(0, 1.2, 4.3), V(0, 1.3, -4.2));
const FISHING_LAMPS = boatLamps(V(0, 5.5, -2.4), V(0, 1.3, 3.9), V(0, 1.4, -4.0), [{ at: V(0, 2.2, 1.5), color: LANTERN, size: 1.4, kind: LAMP.bulb }]);

function createBoats(data: CityData, material: THREE.Material): Boat[] {
  const specs = [
    { z: -1900, off: 420, g: sailboat('#1f4e8c', '#ffd23f', '#ff5a5f') },
    { z: -700, off: 230, g: sailboat('#ffffff', '#ff5a5f', '#38c6d9') },
    { z: 350, off: 560, g: sailboat('#0f7a6c', '#ffffff', '#ffd23f') },
    { z: 1500, off: 300, g: sailboat('#ffffff', '#2f6fb3', '#ff8ac6') },
    { z: 2600, off: 700, g: sailboat('#8c2f1f', '#ffffff', '#7dd87d') },
    { z: -250, off: 190, g: fishingBoat(), slow: true },
  ];
  return specs.map((s, i) => {
    const mesh = new THREE.Mesh(s.g, material);
    mesh.name = 'boat';
    mesh.scale.setScalar(1.4); // a touch larger than life so they read from the air
    const slow = 'slow' in s;
    return { mesh, cx: coastX(data.coast, s.z) - s.off, cz: s.z, rx: slow ? 50 : 120, rz: slow ? 80 : 340, speed: slow ? 1.2 : 3.2, phase: i * 1.7, lamps: slow ? FISHING_LAMPS : SAILBOAT_LAMPS };
  });
}

function updateBoat(b: Boat, time: number) {
  const w = b.speed / Math.max(b.rx, b.rz);
  const a = time * w + b.phase;
  b.mesh.position.set(b.cx + Math.cos(a) * b.rx, Math.sin(time * 1.25 + b.phase) * 0.18, b.cz + Math.sin(a) * b.rz);
  const heading = Math.atan2(-Math.sin(a) * b.rx, Math.cos(a) * b.rz); // tangent of the ellipse
  b.mesh.rotation.set(Math.sin(time * 0.9 + b.phase) * 0.035, heading, 0.08 + Math.sin(time * 1.1 + b.phase) * 0.05, 'YXZ');
}

function gullGeometry(): THREE.BufferGeometry {
  const p = new Parts();
  p.add(new THREE.SphereGeometry(0.13, 8, 6), '#ffffff', at(0, 0, 0, undefined, V(1, 0.85, 2.8)));
  p.add(new THREE.SphereGeometry(0.1, 8, 6), '#ffffff', at(0, 0.05, 0.34));
  p.add(new THREE.ConeGeometry(0.03, 0.12, 5), '#ffc21a', at(0, 0.04, 0.47, new THREE.Euler(Math.PI / 2, 0, 0)));
  p.add(triangle(V(0, 0.02, -0.25), V(0.12, 0.02, -0.5), V(-0.12, 0.02, -0.5)), '#d6dbe2');
  for (const s of [1, -1]) {
    p.add(triangle(V(0.08 * s, 0.03, 0.12), V(0.45 * s, 0.03, 0.06), V(0.08 * s, 0.03, -0.16)), '#dfe3e8');
    p.add(triangle(V(0.45 * s, 0.03, 0.06), V(0.45 * s, 0.03, -0.14), V(0.08 * s, 0.03, -0.16)), '#dfe3e8');
    p.add(triangle(V(0.45 * s, 0.03, 0.06), V(0.72 * s, 0.03, -0.06), V(0.45 * s, 0.03, -0.14)), '#c9cfd8');
    p.add(triangle(V(0.72 * s, 0.03, -0.06), V(0.86 * s, 0.03, -0.14), V(0.6 * s, 0.03, -0.12)), '#2b2b2e');
  }
  return p.build();
}

function gullMaterial(time: { value: number }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec2 aFlap;\nattribute float aPerch;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float w = max(abs(transformed.x) - 0.08, 0.0);
        float gliding = smoothstep(-0.2, 0.4, sin(uTime * 0.35 + aFlap.x));
        float flap = sin(uTime * aFlap.y + aFlap.x) * mix(0.15, 1.0, gliding);
        transformed.y += (w * flap * 0.9 + w * w * flap * 0.8 + w * 0.12) * (1.0 - aPerch) + w * 0.2 * aPerch;
        transformed.x -= sign(transformed.x) * w * 0.8 * aPerch; // perched: wings folded along the back`);
  };
  return mat;
}

interface Flock {
  mesh: THREE.InstancedMesh;
  pos: THREE.Vector3[];
  vel: THREE.Vector3[];
  /** 0 flying .. 1 wings folded, eased toward `perched`. */
  fold: THREE.InstancedBufferAttribute;
  perched: boolean[];
  roost: THREE.Vector3[];
  roostYaw: number[];
  launchAt: Float32Array;
  home: boolean;
}

/** Spots on the sand a little apart, every gull facing roughly out to sea. */
function roostSlots(center: THREE.Vector3, count: number, rand: () => number): { roost: THREE.Vector3[]; roostYaw: number[] } {
  const roost: THREE.Vector3[] = [];
  while (roost.length < count) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 10;
    const p = center.clone().add(V(Math.cos(a) * r, 0, Math.sin(a) * r * 1.6));
    if (roost.every((q) => q.distanceTo(p) > 1.6)) roost.push(p);
  }
  return { roost, roostYaw: roost.map(() => -Math.PI / 2 + (rand() - 0.5) * 1.4) };
}

function createFlock(count: number, start: THREE.Vector3, roostCenter: THREE.Vector3, time: { value: number }): Flock {
  const rand = seeded(7);
  const geo = gullGeometry();
  geo.setAttribute('aFlap', new THREE.InstancedBufferAttribute(new Float32Array(Array.from({ length: count * 2 }, (_, i) => (i % 2 ? 7 + rand() * 3 : rand() * 20))), 2));
  const fold = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPerch', fold);
  const mesh = new THREE.InstancedMesh(geo, gullMaterial(time), count);
  mesh.name = 'gulls';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const pos = Array.from({ length: count }, () => start.clone().add(V((rand() - 0.5) * 30, (rand() - 0.5) * 8, (rand() - 0.5) * 30)));
  const vel = Array.from({ length: count }, () => V(rand() - 0.5, 0, 1).setLength(9));
  return { mesh, pos, vel, fold, perched: pos.map(() => false), ...roostSlots(roostCenter, count, rand), launchAt: new Float32Array(count), home: false };
}

const GULL_SCALE = 1.25;
const PERCH_HEIGHT = 0.1 + 0.14 * GULL_SCALE; // belly on the sand strip, which sits at y 0.1
const tmp = new THREE.Vector3(), center = new THREE.Vector3(), align = new THREE.Vector3(), steer = new THREE.Vector3();
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), roll = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1).multiplyScalar(GULL_SCALE);
const UP = new THREE.Vector3(0, 1, 0), ZERO = new THREE.Vector3(), FORWARD = new THREE.Vector3(0, 0, 1);

/** Starts or ends the trip home; when it ends the perched gulls take off one after another. */
function setHome(f: Flock, home: boolean, time: number) {
  if (home === f.home) return;
  f.home = home;
  if (!home) f.launchAt.forEach((_, i) => { f.launchAt[i] = time + i * 0.15 + Math.random() * 0.4; });
}

function launch(f: Flock, i: number) {
  f.perched[i] = false;
  f.vel[i].set(-1 + Math.random() * 0.6, 1.2, (Math.random() - 0.5) * 1.2).setLength(7);
}

function updateFlock(f: Flock, dt: number, time: number, target: THREE.Vector3, bird: THREE.Vector3) {
  const n = f.pos.length;
  let flying = 0;
  center.set(0, 0, 0);
  align.set(0, 0, 0);
  for (let i = 0; i < n; i++) {
    const spooked = f.home && f.pos[i].distanceToSquared(bird) < SPOOK_RADIUS * SPOOK_RADIUS;
    if (f.perched[i] && (spooked || (!f.home && time >= f.launchAt[i]))) launch(f, i);
    if (f.perched[i]) continue;
    flying++;
    center.add(f.pos[i]);
    align.add(f.vel[i]);
  }
  for (let i = 0; i < n; i++) {
    const v = f.fold.getX(i), to = f.perched[i] ? 1 : 0;
    if (v === to) continue;
    f.fold.setX(i, Math.abs(to - v) < 0.01 ? to : v + (to - v) * Math.min(1, dt * 6));
    f.fold.needsUpdate = true;
  }
  if (flying === 0) return; // the whole flock sleeps on the sand: no steering, matrices unchanged
  center.divideScalar(flying);
  align.divideScalar(flying);

  for (let i = 0; i < n; i++) {
    if (f.perched[i]) continue;
    const p = f.pos[i], v = f.vel[i], slot = f.roost[i];
    const toSlot = Math.hypot(slot.x - p.x, slot.z - p.z);
    const away = THREE.MathUtils.smoothstep(toSlot, 4, 40); // 0 at the roost: low and slow is allowed there
    if (f.home) {
      tmp.set(slot.x, slot.y + Math.min(toSlot * 0.35, 30), slot.z).sub(p); // glide path down to the slot
      steer.copy(tmp).setLength(Math.min(12, 1 + tmp.length() * 0.6)).sub(v).multiplyScalar(1.6);
    } else {
      steer.subVectors(target, p).multiplyScalar(0.025).clampLength(0, 4);
      steer.addScaledVector(tmp.subVectors(center, p), 0.04);
      steer.addScaledVector(tmp.subVectors(align, v), 0.4);
    }
    if (!f.home || toSlot > 10) {
      for (let j = 0; j < n; j++) {
        if (j === i || f.perched[j]) continue;
        tmp.subVectors(p, f.pos[j]);
        const d2 = tmp.lengthSq();
        if (d2 < 16 && d2 > 1e-4) steer.addScaledVector(tmp, 6 / d2);
      }
    }
    tmp.subVectors(p, bird);
    const db = tmp.length();
    if (db < 35) steer.addScaledVector(tmp.normalize(), (35 - db) * 0.8); // scatter from the macaw
    v.addScaledVector(steer, dt);
    if (!f.home) v.y *= 0.98;
    v.setLength(THREE.MathUtils.clamp(v.length(), 7 * away, 14));
    p.addScaledVector(v, dt);
    p.y = Math.max(p.y, THREE.MathUtils.lerp(slot.y, 8, away));
    if (f.home && toSlot < 0.9 && p.y - slot.y < 0.8) {
      f.perched[i] = true;
      p.copy(slot);
      v.set(0, 0, 0);
    }
    if (f.perched[i] || v.lengthSq() < 1) {
      q.setFromAxisAngle(UP, f.roostYaw[i]);
    } else {
      m4.lookAt(v, ZERO, UP);
      q.setFromRotationMatrix(m4).multiply(roll.setFromAxisAngle(FORWARD, THREE.MathUtils.clamp(-steer.dot(tmp.crossVectors(UP, v).normalize()) * 0.08, -0.6, 0.6)));
    }
    f.mesh.setMatrixAt(i, m4.compose(p, q, one));
  }
  f.mesh.instanceMatrix.needsUpdate = true;
}

const ENVELOPE: [number, number][] = [[1.3, 0], [2.6, 2], [4.6, 4.5], [6.6, 7.5], [7.9, 10.5], [8.4, 13], [8.2, 15.5], [7.3, 18], [5.5, 20.2], [3, 21.6], [0.01, 22]];

function balloonGeometry(colors: string[]): THREE.BufferGeometry {
  const gores = 16;
  const lathe = new THREE.LatheGeometry(ENVELOPE.map(([r, y]) => new THREE.Vector2(r, y)), gores * 2).toNonIndexed();
  lathe.computeVertexNormals();
  const pos = lathe.attributes.position;
  const palette = colors.map((c) => new THREE.Color(c));
  const col = new Float32Array(pos.count * 3);
  for (let t = 0; t < pos.count; t += 3) {
    const cx = pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2), cz = pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2);
    const gore = Math.floor(((Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2)) * gores) % gores;
    const c = palette[gore % palette.length];
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (t + k) * 3);
  }
  lathe.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new Parts().add(lathe, null);
  p.box(1.5, 1.1, 1.5, '#8a5a2b', 0, -3.6, 0);
  p.box(1.6, 0.15, 1.6, '#5e3a17', 0, -3.0, 0);
  p.box(0.5, 0.4, 0.5, '#444444', 0, -1.6, 0);
  for (const [x, z] of [[0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) p.beam(V(x, -3.0, z), V(x * 1.6, 0.1, z * 1.6), 0.05, '#3b3b3b');
  return p.build();
}

interface Balloon { mesh: THREE.Mesh; cx: number; cz: number; r: number; alt: number; phase: number }

const BALLOON_LAMPS: Lamp[] = [{ at: V(0, -0.9, 0), color: new THREE.Color('#ff9a3c'), size: 4, kind: LAMP.flame }];

/** Light from the burner shining through the lower envelope at night. */
function balloonMaterial(time: { value: number }, burnerGlow: { value: number }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.uniforms.uBurnerGlow = burnerGlow;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying float vEnvelopeY;\nvarying float vBurn;\n${BURNER_GLSL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEnvelopeY = position.y;\nvBurn = burner(uTime, modelMatrix[3].x);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBurnerGlow;\nvarying float vEnvelopeY;\nvarying float vBurn;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.72, 0.45) * uBurnerGlow * vBurn * step(0.0, vEnvelopeY) * smoothstep(16.0, 1.0, vEnvelopeY) * 5.0;`);
  };
  return mat;
}

/** Fog uniforms for a ShaderMaterial with fog: true; three refreshes fogDensity on them every frame. */
const fogUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
const FOG_FADE_GLSL = /* glsl */ `
uniform float fogDensity;
float fogFade(float dist) { return exp(-fogDensity * dist * 0.6); } // lights carry farther through the haze than surfaces`;

/** Boat lanterns and the balloon burner flames, one Points draw. */
function lampPoints(lamps: Lamp[], shared: Record<string, THREE.IUniform>) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lamps.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(lamps.flatMap((l) => l.color.toArray()), 3));
  g.setAttribute('aLamp', new THREE.Float32BufferAttribute(lamps.flatMap((l, i) => [l.size, l.kind, i * 2.39]), 3));
  const material = fxMaterial({
    fog: true,
    uniforms: { ...shared, uScale: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute vec3 aLamp; // size in meters, kind, phase
      uniform float uTime; uniform float uScale; uniform float uGlow;
      varying vec3 vColor; varying float vAlpha; varying float vFlame;
      ${BURNER_GLSL}
      ${FOG_FADE_GLSL}
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(2.0, uScale * aLamp.x / -mv.z);
        vFlame = step(${(LAMP.flame - 0.5).toFixed(1)}, aLamp.y);
        float flicker = mix(0.85 + 0.15 * sin(uTime * 2.1 + aLamp.z), burner(uTime, position.x), vFlame);
        vAlpha = uGlow * flicker * fogFade(-mv.z);
        vColor = aColor;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vAlpha; varying float vFlame;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d);
        vec3 bulb = vColor * exp(-r2 * 14.0) * 0.5 + mix(vColor, vec3(1.0), 0.6) * exp(-r2 * 70.0) * 1.2;
        vec2 f = vec2(d.x * 2.4, (d.y + 0.12) * (d.y < -0.12 ? 1.0 : 2.6)); // teardrop, tip up
        float rf = dot(f, f);
        vec3 flame = mix(vColor, vec3(1.0, 0.92, 0.7), exp(-rf * 50.0)) * exp(-rf * 16.0) * 1.6;
        gl_FragColor = vec4(mix(bulb, flame, vFlame) * vAlpha * 2.0, 1.0);
      }`,
  });
  const points = new THREE.Points(g, material);
  points.frustumCulled = false;
  return points;
}

/** Shimmering streaks lying on the water under the lanterns, stretched toward the camera like real reflections. */
function reflectionStreaks(lamps: Lamp[], shared: Record<string, THREE.IUniform>) {
  const corners = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lamps.length * 12), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(lamps.flatMap(() => corners.flat()), 2));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(lamps.flatMap((l) => [0, 1, 2, 3].flatMap(() => l.color.toArray())), 3));
  g.setAttribute('aStreak', new THREE.Float32BufferAttribute(lamps.flatMap((l, i) => [0, 1, 2, 3].flatMap(() => [l.size, i * 1.7])), 2));
  g.setIndex(lamps.flatMap((_, i) => [0, 1, 2, 0, 2, 3].map((k) => i * 4 + k)));
  const material = fxMaterial({
    fog: true,
    side: THREE.DoubleSide,
    uniforms: shared,
    vertexShader: /* glsl */ `
      attribute vec2 aCorner; attribute vec3 aColor; attribute vec2 aStreak; // length in meters, phase
      uniform float uGlow;
      varying vec2 vUv; varying vec3 vColor; varying float vAlpha; varying float vPhase;
      ${FOG_FADE_GLSL}
      void main() {
        vec2 toCam = cameraPosition.xz - position.xz;
        float camDist = length(toCam);
        vec2 dir = toCam / max(camDist, 1e-3);
        float len = min(aStreak.x, camDist * 0.6);
        vec2 xz = position.xz + vec2(-dir.y, dir.x) * aCorner.x * len * 0.06 + dir * aCorner.y * len;
        vec4 mv = modelViewMatrix * vec4(xz.x, position.y, xz.y, 1.0);
        gl_Position = projectionMatrix * mv;
        vUv = aCorner;
        vColor = aColor;
        vPhase = aStreak.y;
        vAlpha = uGlow * fogFade(-mv.z);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv; varying vec3 vColor; varying float vAlpha; varying float vPhase;
      void main() {
        float across = exp(-vUv.x * vUv.x * 4.0);
        float along = smoothstep(0.0, 0.06, vUv.y) * (1.0 - vUv.y);
        float ripple = 0.4 + 0.6 * sin(vUv.y * 40.0 - uTime * 2.5 + vPhase + vUv.x * 2.0);
        gl_FragColor = vec4(vColor * across * along * ripple * vAlpha * 1.2, 1.0);
      }`,
  });
  return new THREE.Mesh(g, material);
}

/**
 * Every night light that rides on a boat or a balloon. They fade with the scene's fog density by hand: the
 * atmosphere's fog chunks need uniforms a ShaderMaterial does not get.
 */
function createLamps(carriers: { object: THREE.Object3D; lamps: Lamp[] }[]) {
  const all = carriers.flatMap((c) => c.lamps.map((lamp) => ({ lamp, object: c.object })));
  const lights = all.filter((a) => a.lamp.kind !== LAMP.reflection);
  const streaks = all.filter((a) => a.lamp.kind === LAMP.reflection);
  const shared = { ...fogUniforms(), uTime: { value: 0 }, uGlow: { value: 0 } };
  const points = lampPoints(lights.map((a) => a.lamp), shared);
  const reflections = reflectionStreaks(streaks.map((a) => a.lamp), shared);
  const objects = [points, reflections];
  for (const o of objects) {
    o.renderOrder = 2;
    o.visible = false;
  }
  return {
    objects,
    shared,
    get visible() { return points.visible; },
    set visible(v: boolean) { points.visible = reflections.visible = v; },
    setScale(scale: number) { points.material.uniforms.uScale.value = scale; },
    /** Carriers' matrices must be current. */
    place() {
      const p = points.geometry.attributes.position as THREE.BufferAttribute;
      lights.forEach(({ lamp, object }, i) => {
        tmp.copy(lamp.at).applyMatrix4(object.matrix);
        p.setXYZ(i, tmp.x, tmp.y, tmp.z);
      });
      p.needsUpdate = true;
      const r = reflections.geometry.attributes.position as THREE.BufferAttribute;
      streaks.forEach(({ lamp, object }, i) => {
        tmp.copy(lamp.at).applyMatrix4(object.matrix);
        for (let k = 0; k < 4; k++) r.setXYZ(i * 4 + k, tmp.x, lamp.at.y, tmp.z);
      });
      r.needsUpdate = true;
    },
  };
}

export function createAmbient(data: CityData, quality: Quality): Ambient {
  const time = { value: 0 };
  const boatFabric = backlitFabric(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: BOAT_ROUGHNESS, side: THREE.DoubleSide }), 0.35);
  const boats = createBoats(data, boatFabric.material);

  const gullStart = V(coastX(data.coast, 0) + 20, 28, 0);
  const roost = V(coastX(data.coast, ROOST_Z) + ROOST_UP_BEACH, PERCH_HEIGHT, ROOST_Z);
  const flock = createFlock(quality === 'low' ? 12 : 20, gullStart, roost, time);
  const flockTarget = new THREE.Vector3();

  const burnerGlow = { value: 0 };
  const balloonMat = balloonMaterial(time, burnerGlow);
  const balloons: Balloon[] = [
    { mesh: new THREE.Mesh(balloonGeometry(['#ff4f6d', '#ffd23f', '#4dd8ff', '#ffffff']), balloonMat), cx: -1300, cz: 300, r: 650, alt: 240, phase: 0 },
    { mesh: new THREE.Mesh(balloonGeometry(['#7a4dff', '#ff9f1c', '#7dff6a', '#ff4fb8']), balloonMat), cx: 500, cz: -1900, r: 800, alt: 280, phase: 2.4 },
  ];
  for (const b of balloons) {
    b.mesh.name = 'balloon';
    b.mesh.scale.setScalar(1.4);
  }
  const lamps = createLamps([...boats.map((b) => ({ object: b.mesh, lamps: b.lamps })), ...balloons.map((b) => ({ object: b.mesh, lamps: BALLOON_LAMPS }))]);

  return {
    objects: [...boats.map((b) => b.mesh), flock.mesh, ...balloons.map((b) => b.mesh), ...lamps.objects],
    applyLighting(m) {
      boatFabric.setDaylight(m.daylight);
      soak(boatFabric.material, BOAT_ROUGHNESS, m.wet);
      burnerGlow.value = m.glow;
      lamps.visible = lit(m);
      lamps.shared.uGlow.value = m.glow;
      setHome(flock, m.rain > 0.3 || m.glow > 0.6, time.value);
    },
    update(dt, t, bird, pointScale) {
      time.value = t;
      for (const b of boats) updateBoat(b, t);

      const z = Math.sin(t * 0.0065) * 1400; // the flock cruises up and down the beach
      flockTarget.set(coastX(data.coast, z) + 25, 30 + Math.sin(t * 0.21) * 8, z);
      updateFlock(flock, Math.min(dt, 0.05), t, flockTarget, bird);

      for (const b of balloons) {
        const a = t * (2.2 / b.r) + b.phase;
        b.mesh.position.set(b.cx + Math.cos(a) * b.r, b.alt + Math.sin(t * 0.15 + b.phase) * 6, b.cz + Math.sin(a) * b.r * 0.6);
        b.mesh.rotation.y = t * 0.03 + b.phase;
      }
      if (lamps.visible) {
        for (const b of boats) b.mesh.updateMatrix();
        for (const b of balloons) b.mesh.updateMatrix();
        lamps.shared.uTime.value = t;
        lamps.setScale(pointScale);
        lamps.place();
      }
    },
  };
}
