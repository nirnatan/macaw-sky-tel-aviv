import * as THREE from 'three';
import type { CityData, Ring } from '../../world/data';
import type { Quality } from '../../contracts';
import { at, backlitFabric, Parts, seeded } from './parts';

export interface Ambient {
  readonly objects: THREE.Object3D[];
  update(dt: number, time: number, bird: THREE.Vector3): void;
}

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

interface Boat { mesh: THREE.Mesh; cx: number; cz: number; rx: number; rz: number; speed: number; phase: number }

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
    return { mesh, cx: coastX(data.coast, s.z) - s.off, cz: s.z, rx: slow ? 50 : 120, rz: slow ? 80 : 340, speed: slow ? 1.2 : 3.2, phase: i * 1.7 };
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
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec2 aFlap;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float w = max(abs(transformed.x) - 0.08, 0.0);
        float gliding = smoothstep(-0.2, 0.4, sin(uTime * 0.35 + aFlap.x));
        float flap = sin(uTime * aFlap.y + aFlap.x) * mix(0.15, 1.0, gliding);
        transformed.y += w * flap * 0.9 + w * w * flap * 0.8 + w * 0.12;`);
  };
  return mat;
}

interface Flock { mesh: THREE.InstancedMesh; pos: THREE.Vector3[]; vel: THREE.Vector3[] }

function createFlock(count: number, start: THREE.Vector3, time: { value: number }): Flock {
  const rand = seeded(7);
  const geo = gullGeometry();
  geo.setAttribute('aFlap', new THREE.InstancedBufferAttribute(new Float32Array(Array.from({ length: count * 2 }, (_, i) => (i % 2 ? 7 + rand() * 3 : rand() * 20))), 2));
  const mesh = new THREE.InstancedMesh(geo, gullMaterial(time), count);
  mesh.name = 'gulls';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const pos = Array.from({ length: count }, () => start.clone().add(V((rand() - 0.5) * 30, (rand() - 0.5) * 8, (rand() - 0.5) * 30)));
  const vel = Array.from({ length: count }, () => V(rand() - 0.5, 0, 1).setLength(9));
  return { mesh, pos, vel };
}

const GULL_SCALE = 1.25;
const tmp = new THREE.Vector3(), center = new THREE.Vector3(), align = new THREE.Vector3(), steer = new THREE.Vector3();
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), roll = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1).multiplyScalar(GULL_SCALE);
const UP = new THREE.Vector3(0, 1, 0), ZERO = new THREE.Vector3(), FORWARD = new THREE.Vector3(0, 0, 1);

function updateFlock(f: Flock, dt: number, target: THREE.Vector3, bird: THREE.Vector3) {
  const n = f.pos.length;
  center.set(0, 0, 0);
  align.set(0, 0, 0);
  for (let i = 0; i < n; i++) { center.add(f.pos[i]); align.add(f.vel[i]); }
  center.divideScalar(n);
  align.divideScalar(n);
  for (let i = 0; i < n; i++) {
    const p = f.pos[i], v = f.vel[i];
    steer.subVectors(target, p).multiplyScalar(0.025).clampLength(0, 4);
    steer.addScaledVector(tmp.subVectors(center, p), 0.04);
    steer.addScaledVector(tmp.subVectors(align, v), 0.4);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      tmp.subVectors(p, f.pos[j]);
      const d2 = tmp.lengthSq();
      if (d2 < 16 && d2 > 1e-4) steer.addScaledVector(tmp, 6 / d2);
    }
    tmp.subVectors(p, bird);
    const db = tmp.length();
    if (db < 35) steer.addScaledVector(tmp.normalize(), (35 - db) * 0.8); // scatter from the macaw
    v.addScaledVector(steer, dt);
    v.y *= 0.98;
    const speed = THREE.MathUtils.clamp(v.length(), 7, 14);
    v.setLength(speed);
    p.addScaledVector(v, dt);
    if (p.y < 8) p.y = 8;
    m4.lookAt(v, ZERO, UP);
    q.setFromRotationMatrix(m4).multiply(roll.setFromAxisAngle(FORWARD, THREE.MathUtils.clamp(-steer.dot(tmp.crossVectors(UP, v).normalize()) * 0.08, -0.6, 0.6)));
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

export function createAmbient(data: CityData, quality: Quality): Ambient {
  const time = { value: 0 };
  const boatMat = backlitFabric(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }), 0.35);
  const boats = createBoats(data, boatMat);

  const gullStart = V(coastX(data.coast, 0) + 20, 28, 0);
  const flock = createFlock(quality === 'low' ? 12 : 20, gullStart, time);
  const flockTarget = new THREE.Vector3();

  const balloonMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  const balloons: Balloon[] = [
    { mesh: new THREE.Mesh(balloonGeometry(['#ff4f6d', '#ffd23f', '#4dd8ff', '#ffffff']), balloonMat), cx: -1300, cz: 300, r: 650, alt: 240, phase: 0 },
    { mesh: new THREE.Mesh(balloonGeometry(['#7a4dff', '#ff9f1c', '#7dff6a', '#ff4fb8']), balloonMat), cx: 500, cz: -1900, r: 800, alt: 280, phase: 2.4 },
  ];
  for (const b of balloons) b.mesh.scale.setScalar(1.4);

  return {
    objects: [...boats.map((b) => b.mesh), flock.mesh, ...balloons.map((b) => b.mesh)],
    update(dt, t, bird) {
      time.value = t;
      for (const b of boats) updateBoat(b, t);

      const z = Math.sin(t * 0.0065) * 1400; // the flock cruises up and down the beach
      flockTarget.set(coastX(data.coast, z) + 25, 30 + Math.sin(t * 0.21) * 8, z);
      updateFlock(flock, Math.min(dt, 0.05), flockTarget, bird);

      for (const b of balloons) {
        const a = t * (2.2 / b.r) + b.phase;
        b.mesh.position.set(b.cx + Math.cos(a) * b.r, b.alt + Math.sin(t * 0.15 + b.phase) * 6, b.cz + Math.sin(a) * b.r * 0.6);
        b.mesh.rotation.y = t * 0.03 + b.phase;
      }
    },
  };
}
