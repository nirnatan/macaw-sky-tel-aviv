// Three tree species as instanced meshes per chunk: OSM tree points, scatter inside green areas, street trees
// along residential roads and boulevards, palms along the beach. Wind sway runs in the vertex shader.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AreaKind, CityData, RoadKind } from './data';
import { ChunkGrid, hash2, releaseAfterUpload, ringArea, rng, samplePointsInPolygon, walkPolyline } from './geom';
import type { CityPhysics } from './physics';
import { after, srgb } from './shaders';

const SPECIES = ['ficus', 'palm', 'cypress'] as const;
type Species = (typeof SPECIES)[number];
type Rgb = [number, number, number];

interface SpeciesSpec { geometry: () => THREE.BufferGeometry; height: number; sway: number; side: THREE.Side; castShadow: boolean }
const SPEC: Record<Species, SpeciesSpec> = {
  ficus: { geometry: ficusGeometry, height: 7, sway: 0.22, side: THREE.FrontSide, castShadow: true },
  palm: { geometry: palmGeometry, height: 9.5, sway: 0.5, side: THREE.DoubleSide, castShadow: true },
  cypress: { geometry: cypressGeometry, height: 8, sway: 0.12, side: THREE.FrontSide, castShadow: true },
};
/** Trees per square meter inside each area kind, and how the species split. */
const AREA_SCATTER: Partial<Record<AreaKind, { density: number; mix: [number, number, number] }>> = {
  park: { density: 1 / 950, mix: [0.72, 0.16, 0.12] },
  grass: { density: 1 / 3200, mix: [0.85, 0.1, 0.05] },
  forest: { density: 1 / 320, mix: [0.5, 0, 0.5] },
  cemetery: { density: 1 / 450, mix: [0.2, 0, 0.8] },
};
const STREET: Partial<Record<RoadKind, { spacing: number; bothSides: boolean }>> = {
  residential: { spacing: 60, bothSides: false },
  tertiary: { spacing: 55, bothSides: true },
  secondary: { spacing: 50, bothSides: true },
};

export interface TreeLayer {
  byChunk: THREE.Group[];
  time: { value: number };
  materials: THREE.MeshStandardMaterial[];
  setDensity(fraction: number): void;
  /** Scales every species' sway (1 = a calm sea breeze). */
  setWind(strength: number): void;
}

export function buildTrees(data: CityData, grid: ChunkGrid, physics: CityPhysics, keep: number): TreeLayer {
  const rand = rng(11);
  const lists: Record<Species, number[][]> = { ficus: [], palm: [], cypress: [] };
  for (const s of SPECIES) lists[s] = Array.from({ length: grid.count }, () => []);
  const place = (species: Species, x: number, z: number, scaleJitter = 0.25) => {
    if (Math.abs(x) > grid.half || Math.abs(z) > grid.half || physics.insideFootprint(x, z)) return;
    lists[species][grid.indexOf(x, z)].push(x, z, 1 - scaleJitter + rand() * 2 * scaleJitter, rand() * Math.PI * 2);
  };
  const pick = (mix: [number, number, number]): Species => {
    const r = rand();
    return r < mix[0] ? 'ficus' : r < mix[0] + mix[1] ? 'palm' : 'cypress';
  };

  for (let i = 0; i < data.trees.length; i += 2) place(rand() < 0.1 ? 'palm' : 'ficus', data.trees[i], data.trees[i + 1]);

  for (const a of data.areas) {
    const scatter = AREA_SCATTER[a.kind];
    if (!scatter) continue;
    const count = Math.min(600, Math.round(ringArea(a.rings[0]) * scatter.density));
    const pts = samplePointsInPolygon(a.rings, count, 1.5, rand);
    for (let i = 0; i < pts.length; i += 2) place(pick(scatter.mix), pts[i], pts[i + 1]);
  }

  for (const r of data.roads) {
    const street = STREET[r.kind];
    if (!street || r.bridge) continue;
    const offset = r.width / 2 + 1.6;
    let side = rand() < 0.5 ? 1 : -1;
    walkPolyline(r.pts, street.spacing, rand() * street.spacing, (x, z, dx, dz) => {
      place('ficus', x - dz * offset * side, z + dx * offset * side, 0.2);
      if (street.bothSides) place('ficus', x + dz * offset * side, z - dx * offset * side, 0.2);
      else side = -side;
    });
  }

  walkPolyline(data.coast, 17, 5, (x, z, dx, dz) => {
    let nx = -dz, nz = dx;
    if (nx < 0) { nx = -nx; nz = -nz; }
    const inland = 40 + rand() * 40;
    place('palm', x + nx * inland, z + nz * inland, 0.2);
  });

  const time = { value: 0 };
  const byChunk = Array.from({ length: grid.count }, () => new THREE.Group());
  const instanced: { mesh: THREE.InstancedMesh; full: number }[] = [];
  const materials: THREE.MeshStandardMaterial[] = [];
  const sways: { uniform: { value: number }; calm: number }[] = [];
  for (const species of SPECIES) {
    const spec = SPEC[species];
    const geometry = spec.geometry();
    const sway = { value: spec.sway };
    const material = treeMaterial(spec, time, sway);
    materials.push(material);
    sways.push({ uniform: sway, calm: spec.sway });
    lists[species].forEach((list, chunk) => {
      const full = list.length / 4;
      if (!full) return;
      const order = Array.from({ length: full }, (_, i) => i);
      for (let i = full - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, Math.ceil(full * keep)));
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
      for (let dst = 0; dst < mesh.count; dst++) {
        const src = order[dst];
        const x = list[4 * src], z = list[4 * src + 1], k = list[4 * src + 2];
        p.set(x, 0, z);
        q.setFromAxisAngle(up, list[4 * src + 3]);
        s.set(k, k * (0.9 + 0.2 * hash2(x, z, 1)), k);
        mesh.setMatrixAt(dst, m.compose(p, q, s));
        const warm = hash2(x, z, 2);
        mesh.setColorAt(dst, c.setRGB(0.9 + 0.2 * warm, 0.92 + 0.12 * hash2(x, z, 3), 0.9 + 0.1 * (1 - warm)));
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = spec.castShadow;
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.computeBoundingSphere();
      releaseAfterUpload(mesh.instanceMatrix, mesh.instanceColor!);
      byChunk[chunk].add(mesh);
      instanced.push({ mesh, full });
    });
  }
  return {
    byChunk, time, materials,
    setDensity(fraction) { for (const t of instanced) t.mesh.count = Math.min(t.mesh.instanceMatrix.count, Math.max(1, Math.round(t.full * fraction))); },
    setWind(strength) { for (const s of sways) s.uniform.value = s.calm * strength; },
  };
}

function treeMaterial(spec: SpeciesSpec, time: { value: number }, sway: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: spec.side });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uSway = sway;
    shader.uniforms.uHeight = { value: spec.height };
    shader.vertexShader = after(shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime, uSway, uHeight;'), 'begin_vertex', /* glsl */ `
      #ifdef USE_INSTANCING
        vec3 iPos = instanceMatrix[3].xyz;
        float phase = iPos.x * 0.37 + iPos.z * 0.73;
        float lift = clamp(position.y / uHeight, 0.0, 1.0);
        float gust = sin(uTime * 1.3 + phase) * 0.6 + sin(uTime * 2.9 + phase * 1.7) * 0.3;
        transformed.xz += vec2(0.9, 0.35) * gust * lift * lift * uSway;
      #endif`);
  };
  return m;
}

function paint(g: THREE.BufferGeometry, color: (x: number, y: number, z: number) => Rgb): THREE.BufferGeometry {
  const pos = g.attributes.position, arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) arr.set(color(pos.getX(i), pos.getY(i), pos.getZ(i)), i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}
function lerp(a: Rgb, b: Rgb, t: number): Rgb { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const sized = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const total = sized.reduce((a, p) => a + p.attributes.position.count, 0);
  const position = new Float32Array(total * 3), normal = new Float32Array(total * 3), color = new Float32Array(total * 3);
  let o = 0;
  for (const p of sized) {
    position.set(p.attributes.position.array as Float32Array, o * 3);
    normal.set(p.attributes.normal.array as Float32Array, o * 3);
    color.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return g;
}

const BARK = srgb('#5b4734'), CANOPY_LOW = srgb('#2f5a2a'), CANOPY_TOP = srgb('#66903a');
/** Lumpy broadleaf canopy (ficus-like) on a short trunk. */
function ficusGeometry(): THREE.BufferGeometry {
  const trunk = paint(new THREE.CylinderGeometry(0.24, 0.36, 2.8, 7).translate(0, 1.4, 0), () => BARK);
  const blob = mergeVertices(new THREE.IcosahedronGeometry(1, 1));
  const pos = blob.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const bump = 0.78 + 0.44 * hash2(x * 50, z * 50 + y * 31, 5);
    pos.setXYZ(i, x * 3.4 * bump, Math.max(-1.3, y * 2.6 * bump) + 4.6, z * 3.4 * bump);
  }
  blob.computeVertexNormals();
  paint(blob, (x, y, z) => lerp(CANOPY_LOW, CANOPY_TOP, Math.min(1, Math.max(0, (y - 3.2) / 4.2)) * (0.8 + 0.4 * hash2(x * 20, z * 20, 6))));
  return merge([trunk, blob]);
}
const PALM_TRUNK = srgb('#8a6f50'), FROND = srgb('#4d7f2a'), FROND_TIP = srgb('#86a83c');
function palmGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.17, 0.3, 8.5, 7).translate(0, 4.25, 0);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setX(i, tp.getX(i) + Math.pow(tp.getY(i) / 8.5, 2) * 1.1); // lean toward the light
  trunk.computeVertexNormals();
  paint(trunk, (_x, y) => (Math.floor(y / 0.45) % 2 ? PALM_TRUNK : lerp(PALM_TRUNK, BARK, 0.35)));
  const parts: THREE.BufferGeometry[] = [trunk];
  for (let k = 0; k < 9; k++) {
    const frond = new THREE.PlaneGeometry(1.0, 3.6, 1, 4).rotateX(-Math.PI / 2);
    const fp = frond.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const t = (fp.getZ(i) + 1.8) / 3.6;
      fp.setXYZ(i, fp.getX(i) * (1 - t * 0.6), 1.1 - 2.2 * t * t, 0.4 + t * 3.6);
    }
    frond.rotateY((k / 9) * Math.PI * 2 + 0.3 * hash2(k, 0, 7)).translate(1.1, 8.6, 0);
    frond.computeVertexNormals();
    paint(frond, (x, y, z) => lerp(FROND, FROND_TIP, Math.min(1, Math.hypot(x - 1.1, z) / 4)));
    parts.push(frond);
  }
  const nuts = paint(new THREE.IcosahedronGeometry(0.42, 0).translate(1.1, 8.4, 0), () => srgb('#5a3d22'));
  parts.push(nuts);
  return merge(parts);
}
function cypressGeometry(): THREE.BufferGeometry {
  const trunk = paint(new THREE.CylinderGeometry(0.12, 0.18, 1.2, 6).translate(0, 0.6, 0), () => BARK);
  const dark = srgb('#2d5327'), light = srgb('#4a7a35');
  const cone = paint(new THREE.ConeGeometry(0.95, 7.4, 7).translate(0, 4.6, 0), (_x, y) => lerp(dark, light, (y - 1) / 8));
  return merge([trunk, cone]);
}
