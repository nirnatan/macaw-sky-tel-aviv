// Procedural low-detail skyline outside the data box so the horizon is a city fading into fog, not an empty plain.
import * as THREE from 'three';
import type { CityData } from './data';
import { DATA_HALF, hash01, pointInRing, rng } from './geom';
import { srgb } from './shaders';

const RADIUS = 9000;
const SPACING = 52;
const COAST_MAX_X = 1000; // the coast never reaches further east, so beyond it every candidate is land

export interface Fringe { mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; setFraction(f: number): void }

export function buildFringe(data: CityData): Fringe {
  const rand = rng(23);
  const palette = ['#e7dfd0', '#d9d2c4', '#cfc8bb', '#e2d6c2', '#c9c3b8', '#dcd3c3'].map(srgb);
  const matrices: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let z = -RADIUS; z <= RADIUS; z += SPACING) {
    for (let x = -RADIUS; x <= RADIUS; x += SPACING) {
      if (Math.abs(x) < DATA_HALF && Math.abs(z) < DATA_HALF) continue;
      if (x * x + z * z > RADIUS * RADIUS) continue;
      const jx = x + (rand() - 0.5) * SPACING * 0.6, jz = z + (rand() - 0.5) * SPACING * 0.6;
      if (jx < COAST_MAX_X && pointInRing(jx, jz, data.sea)) continue;
      const district = valueNoise(jx / 420, jz / 420);
      if (district < 0.36 || rand() < 0.22) continue;
      const bulk = valueNoise(jx / 230 + 5, jz / 230 + 5);
      let h = 8 + bulk * bulk * 34 + rand() * 6;
      if (rand() > 0.985) h = 45 + rand() * 75;
      const w = 12 + rand() * 20, d = 12 + rand() * 20;
      p.set(jx, 0, jz);
      q.setFromAxisAngle(up, valueNoise(jx / 1500, jz / 1500) * 1.2 + (rand() - 0.5) * 0.15);
      s.set(w, h, d);
      matrices.push(m.compose(p, q, s).clone());
      const c = palette[Math.floor(rand() * palette.length)];
      const k = 0.9 + rand() * 0.15;
      colors.push(new THREE.Color(c[0] * k, c[1] * k, c[2] * k));
    }
  }
  const order = matrices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  geometry.deleteAttribute('uv');
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }), matrices.length);
  order.forEach((src, dst) => { mesh.setMatrixAt(dst, matrices[src]); mesh.setColorAt(dst, colors[src]); });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  const max = matrices.length;
  return { mesh, setFraction(f) { mesh.count = Math.round(max * f); } };
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = smooth(x - ix), fz = smooth(z - iz);
  const h = (a: number, b: number) => hash01(a * 7349 + b * 1103 + 17);
  return (h(ix, iz) * (1 - fx) + h(ix + 1, iz) * fx) * (1 - fz) + (h(ix, iz + 1) * (1 - fx) + h(ix + 1, iz + 1) * fx) * fz;
}
function smooth(t: number): number { return t * t * (3 - 2 * t); }
