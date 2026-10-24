// Extruded footprints with a procedural White City facade, plus the rooftop clutter every Tel Aviv roof carries.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Building, BuildingKind, CityData, Ring } from './data';
import { ChunkGrid, GeometryWriter, hash01, insetRing, ringArea, ringCentroid, rng, samplePointsInPolygon, triangulate } from './geom';
import type { Footprint } from './physics';
import { after, CITY_UNIFORMS_GLSL, type CityUniforms, srgb, withWorldPos } from './shaders';

type Rgb = [number, number, number];
/** Surface types the facade shader switches on (integer part of aFacade.w; the fraction carries wall length / 1000). */
const FACADE = { residential: 0, plain: 1, glass: 2, target: 3, roof: 4, parapet: 5, targetRoof: 6 } as const;
type Facade = (typeof FACADE)[keyof typeof FACADE];

const PLASTER = ['#f3eee5', '#efe6d3', '#ecdccd', '#f0e4c2', '#e8dfcd', '#e3e7df', '#e4e2dc', '#f5efe3', '#e9d9c4', '#f1e2d0'].map(srgb);
const GLASS = ['#7fa3c4', '#6f97b8', '#8fb0c2', '#7eaab0', '#6a8fb0'].map(srgb);
const PUBLIC = ['#efe3cf', '#f1e9dc', '#e7d6bd', '#f4ece0'].map(srgb);
const ROOF = srgb('#e0dbd0');
const STYLE: Record<BuildingKind, { walls: Rgb[]; roof: Rgb; wall: Facade; roofType: Facade }> = {
  residential: { walls: PLASTER, roof: ROOF, wall: FACADE.residential, roofType: FACADE.roof },
  tower: { walls: GLASS, roof: srgb('#b9b6ae'), wall: FACADE.glass, roofType: FACADE.roof },
  public: { walls: PUBLIC, roof: ROOF, wall: FACADE.plain, roofType: FACADE.roof },
  religious: { walls: [srgb('#f7f3ea')], roof: srgb('#e0dbd0'), wall: FACADE.plain, roofType: FACADE.roof },
  industrial: { walls: [srgb('#cfc8bb'), srgb('#d8d2c6')], roof: srgb('#a19c93'), wall: FACADE.plain, roofType: FACADE.roof },
  landmark: { walls: [srgb('#eadfca'), srgb('#e6d2b4')], roof: srgb('#cfc5b4'), wall: FACADE.plain, roofType: FACADE.roof },
  target: { walls: [srgb('#ff8a65')], roof: srgb('#ffd54f'), wall: FACADE.target, roofType: FACADE.targetRoof },
};
const PARAPET = 0.9;
const PARAPET_INSET = 0.45;
const ROOF_BOX = { w: 3.2, d: 2.6, h: 2.4 };
const LAYOUT = [{ name: 'position', size: 3 }, { name: 'color', size: 3 }, { name: 'aFacade', size: 4 }];

export interface Buildings {
  chunks: (THREE.Mesh | null)[];
  heaters: (THREE.InstancedMesh | null)[];
  acUnits: (THREE.InstancedMesh | null)[];
  clutterMaterial: THREE.MeshStandardMaterial;
  footprints: Footprint[];
}

/** OSM heights with the one absurd outlier (6.5 km) replaced and the rest capped at Tel Aviv's tallest. */
function buildingHeight(b: Building): number {
  return b.height > 300 ? 12 + b.seed * 6 : Math.min(b.height, 260);
}

export function buildBuildings(data: CityData, grid: ChunkGrid, uniforms: CityUniforms): Buildings {
  const writers: GeometryWriter[] = Array.from({ length: grid.count }, () => new GeometryWriter(LAYOUT, 512));
  const heaterMatrices: number[][] = Array.from({ length: grid.count }, () => []);
  const acMatrices: number[][] = Array.from({ length: grid.count }, () => []);
  const footprints: Footprint[] = [];
  const rand = rng(7);
  const ringKey = (r: ArrayLike<number>) => `${r[0]},${r[1]},${r.length}`;
  const placeRoofs = new Set(Object.values(data.targets).flatMap((t) => (t.building ? [ringKey(t.building.ring)] : [])));

  for (const [index, b] of data.buildings.entries()) {
    const h = buildingHeight(b);
    const outer = b.rings[0];
    const area = ringArea(outer);
    const [cx, cz] = ringCentroid(outer);
    const chunk = grid.indexOf(cx, cz);
    const w = writers[chunk];
    const style = STYLE[b.kind];
    const tint = 0.94 + hash01(b.seed * 1000 + 1) * 0.1;
    const wallColor = scale(style.walls[Math.floor(b.seed * style.walls.length) % style.walls.length], tint);
    const roofColor = scale(style.roof, 0.92 + hash01(b.seed * 1000 + 2) * 0.14);
    footprints.push({ rings: b.rings, height: h, minHeight: b.minHeight });

    const wallInset = 0.005 + (index % 16) * 0.004; // outline edges shared with a part or a neighbour must never give coplanar walls
    for (const ring of b.rings) {
      const wallRing = insetRing(ring, wallInset);
      walls(w, wallRing, b.minHeight, h + PARAPET, wallColor, b.seed, style.wall, h);
      bevel(w, wallRing, insetRing(ring, PARAPET_INSET), h, wallColor, b.seed);
    }
    slab(w, b.rings, h, roofColor, b.seed, style.roofType);

    const flatRoof = b.kind !== 'tower' && b.kind !== 'religious' && !placeRoofs.has(ringKey(outer)); // special places keep their roofs clear for the landing pad
    if (flatRoof && area > 140 && h > 8 && b.minHeight === 0) {
      const spot = samplePointsInPolygon(b.rings, 1, 2.4, rand);
      if (spot.length) footprints.push(roofBox(w, spot[0], spot[1], h, longestEdgeAngle(outer), wallColor, roofColor, b.seed));
    }
    if (flatRoof && area > 50 && h > 5) {
      const heaters = Math.min(5, Math.round(area / 150));
      const acs = Math.min(4, Math.round(area / 320));
      const pts = samplePointsInPolygon(b.rings, heaters + acs, 1.1, rand);
      for (let i = 0; i < pts.length; i += 2) {
        const isHeater = i / 2 < heaters;
        const yaw = isHeater ? (rand() - 0.5) * 0.4 : rand() * Math.PI * 2;
        (isHeater ? heaterMatrices : acMatrices)[chunk].push(pts[i], h, pts[i + 1], yaw);
      }
    }
  }

  const material = facadeMaterial(uniforms);
  const chunks = writers.map((w) => {
    const g = w.toGeometry();
    if (!g) return null;
    const m = new THREE.Mesh(g, material);
    m.castShadow = m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    return m;
  });
  const clutterMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });
  const heaters = heaterMatrices.map((list) => instances(heaterGeometry(), clutterMaterial, list, rand));
  const acUnits = acMatrices.map((list) => instances(acGeometry(), clutterMaterial, list, rand));
  return { chunks, heaters, acUnits, clutterMaterial, footprints };
}

function scale(c: Rgb, k: number): Rgb { return [c[0] * k, c[1] * k, c[2] * k]; }
function longestEdgeAngle(r: Ring): number {
  let best = 0, angle = 0;
  for (let i = 0, n = r.length; i < n; i += 2) {
    const j = (i + 2) % n, dx = r[j] - r[i], dz = r[j + 1] - r[i + 1], l = dx * dx + dz * dz;
    if (l > best) { best = l; angle = Math.atan2(dz, dx); }
  }
  return angle;
}

/** Outward-facing quads around a ring; u runs along each wall from its first corner. */
function walls(w: GeometryWriter, ring: Ring, y0: number, y1: number, c: Rgb, seed: number, type: Facade, top: number): void {
  for (let i = 0, n = ring.length; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = ring[i], az = ring[i + 1], bx = ring[j], bz = ring[j + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const code = type + Math.min(len, 999) / 1000;
    const a0 = w.vertex(ax, y0, az, c[0], c[1], c[2], 0, seed, top, code);
    const a1 = w.vertex(ax, y1, az, c[0], c[1], c[2], 0, seed, top, code);
    const b1 = w.vertex(bx, y1, bz, c[0], c[1], c[2], len, seed, top, code);
    const b0 = w.vertex(bx, y0, bz, c[0], c[1], c[2], len, seed, top, code);
    w.quad(a0, a1, b1, b0);
  }
}
/** The parapet's inner face: a strip from the wall top down to an inset ring at roof level. */
function bevel(w: GeometryWriter, outer: Ring, inner: Float32Array, roofY: number, c: Rgb, seed: number): void {
  const code = FACADE.parapet;
  for (let i = 0, n = outer.length; i < n; i += 2) {
    const j = (i + 2) % n;
    const oa = w.vertex(outer[i], roofY + PARAPET, outer[i + 1], c[0], c[1], c[2], 0, seed, roofY, code);
    const ob = w.vertex(outer[j], roofY + PARAPET, outer[j + 1], c[0], c[1], c[2], 0, seed, roofY, code);
    const ib = w.vertex(inner[j], roofY, inner[j + 1], c[0], c[1], c[2], 0, seed, roofY, code);
    const ia = w.vertex(inner[i], roofY, inner[i + 1], c[0], c[1], c[2], 0, seed, roofY, code);
    w.triUp(oa, ob, ib);
    w.triUp(oa, ib, ia);
  }
}
function slab(w: GeometryWriter, rings: Ring[], y: number, c: Rgb, seed: number, type: Facade): void {
  const base = w.vertexCount;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) w.vertex(r[i], y, r[i + 1], c[0], c[1], c[2], 0, seed, y, type);
  const tris = triangulate(rings);
  for (let i = 0; i < tris.length; i += 3) w.triUp(base + tris[i], base + tris[i + 1], base + tris[i + 2]);
}
/** Stair bulkhead on the roof; returned as a footprint so the bird can stand on it. */
function roofBox(w: GeometryWriter, x: number, z: number, roofY: number, yaw: number, wall: Rgb, roof: Rgb, seed: number): Footprint {
  const cos = Math.cos(yaw), sin = Math.sin(yaw), hw = ROOF_BOX.w / 2, hd = ROOF_BOX.d / 2;
  const ring = new Float32Array(8);
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]; // positive-area order, kept by the rotation
  corners.forEach(([u, v], k) => { ring[2 * k] = x + u * cos - v * sin; ring[2 * k + 1] = z + u * sin + v * cos; });
  const top = roofY + ROOF_BOX.h;
  walls(w, ring, roofY, top, wall, seed, FACADE.parapet, top);
  slab(w, [ring], top, roof, seed, FACADE.roof);
  return { rings: [ring], height: top, minHeight: roofY };
}

function instances(geometry: THREE.BufferGeometry, material: THREE.Material, list: number[], rand: () => number): THREE.InstancedMesh | null {
  const n = list.length / 4;
  if (n === 0) return null;
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } // random order keeps a reduced count uniform
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  order.forEach((src, dst) => {
    p.set(list[4 * src], list[4 * src + 1], list[4 * src + 2]);
    q.setFromAxisAngle(up, list[4 * src + 3]);
    mesh.setMatrixAt(dst, m.compose(p, q, s));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  mesh.matrixAutoUpdate = false;
  return mesh;
}
function colored(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = srgb(hex), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
/** Israeli solar water heater: a south-facing tilted panel with the white tank above its top edge. */
function heaterGeometry(): THREE.BufferGeometry {
  const panel = colored(new THREE.BoxGeometry(1.9, 0.07, 1.15), '#33507a').rotateX(0.6).translate(0, 0.62, 0.1);
  const tank = colored(new THREE.CylinderGeometry(0.28, 0.28, 1.55, 8), '#f1f0ea').rotateZ(Math.PI / 2).translate(0, 1.2, -0.62);
  const legs = colored(new THREE.BoxGeometry(1.7, 0.9, 0.08), '#8d8a84').translate(0, 0.45, -0.62);
  const g = mergeGeometries([panel, tank, legs], false);
  g.deleteAttribute('uv');
  return g;
}
function acGeometry(): THREE.BufferGeometry {
  const g = colored(new THREE.BoxGeometry(0.85, 0.6, 0.4), '#d9d7d0').translate(0, 0.3, 0);
  g.deleteAttribute('uv');
  return g;
}

function facadeMaterial(uniforms: CityUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    withWorldPos(shader, 'varying vec4 vFacade;\n' + CITY_UNIFORMS_GLSL + FACADE_GLSL);
    shader.vertexShader = after(shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aFacade;\nvarying vec4 vFacade;'), 'begin_vertex', 'vFacade = aFacade;');
    shader.fragmentShader = after(shader.fragmentShader, 'color_fragment', /* glsl */ `
      float glass = 0.0, roof = 0.0;
      vec3 lit = vec3(0.0);
      diffuseColor.rgb = facade(diffuseColor.rgb, vFacade, vWorldPos, glass, lit, roof);
      float roofPuddle = step(0.99, roof) * smoothstep(0.6, 0.66, fbm(vWorldPos.xz * 0.3 + 4.0)) * smoothstep(0.35, 0.95, uWet);
      diffuseColor.rgb *= (1.0 - uWet * mix(0.08, 0.34, roof)) * (1.0 - 0.15 * roofPuddle);`);
    shader.fragmentShader = after(shader.fragmentShader, 'roughnessmap_fragment', /* glsl */ `
      roughnessFactor = mix(roughnessFactor, 0.2, glass);
      roughnessFactor = mix(roughnessFactor, mix(0.28, 0.5, uOvercast), uWet * roof); // under cloud the key is a broad source: no mirror glint toward a hidden sun
      roughnessFactor = mix(roughnessFactor, mix(0.06, 0.4, uOvercast), roofPuddle);`);
    shader.fragmentShader = after(shader.fragmentShader, 'metalnessmap_fragment', 'metalnessFactor = mix(mix(metalnessFactor, 0.25, glass), 0.35, roofPuddle);');
    shader.fragmentShader = after(shader.fragmentShader, 'emissivemap_fragment',
      'totalEmissiveRadiance += lit * mix(0.7, 1.6, uNight) + glass * diffuseColor.rgb * 0.12 * (1.0 - uNight);');
  };
  return m;
}

const FACADE_GLSL = /* glsl */ `
const float FLOOR_H = 3.3;
const float BAY_W = 3.0;
const vec3 GLASS_DARK = vec3(0.10, 0.11, 0.13);
const vec3 GLASS_SKY = vec3(0.42, 0.55, 0.70);
const vec3 LIT_DAY = vec3(1.0, 0.6, 0.28);

// Night window color from a second hash: mostly warm lamps, some cool white, the odd blue TV, at 0.6..1.4 brightness.
vec3 windowLight(vec2 id) {
  float h = hash12(id * 1.73 + 11.3), k = hash12(id.yx * 2.31 + 5.1);
  vec3 tint = h < 0.55 ? vec3(1.0, 0.52, 0.2) : h < 0.85 ? vec3(1.0, 0.72, 0.4) : h < 0.95 ? vec3(0.85, 0.86, 0.9) : vec3(0.35, 0.55, 1.0);
  return mix(LIT_DAY, tint * (0.6 + 0.8 * k), uNight);
}

float floorHeight(float top) { return top / max(1.0, floor(top / FLOOR_H + 0.5)); } // whole floors, so no blank attic band

vec3 plasterWalls(vec3 c, float u, float v, float seed, float len, float top, bool pilotis, inout float glass, inout vec3 lit) {
  float fy = v / floorHeight(top);
  float floorIdx = floor(fy), f = fract(fy);
  float uc = u - len * 0.5;
  float bx = (uc + BAY_W * 0.5) / BAY_W;
  float bay = floor(bx), fb = fract(bx);
  float cornerClear = step(0.8, len * 0.5 - abs(uc)) * step(v + 1.2, top);
  float cell = hash12(vec2(bay + seed * 91.0, floorIdx + seed * 37.0));
  float style = hash12(vec2(seed * 17.0, 3.0));
  float band = step(0.4, style) * step(9.0, len) * step(abs(uc), len * 0.34) * step(0.5, floorIdx) * step(v + 1.5, top);
  float balcony = band * step(f, 0.34);
  float recess = band * step(0.34, f);
  float winLow = mix(0.38, 0.42, band);
  float win = step(0.15, fb) * step(fb, 0.85) * step(winLow, f) * step(f, 0.78) * cornerClear * step(0.22, cell);
  float slabLine = step(f, 0.035) * step(0.5, floorIdx) * step(v + 0.5, top);
  if (pilotis && floorIdx < 0.5 && top > 7.0) {
    float column = step(fract(u / 3.6), 0.17);
    c = mix(c * 0.42, c * 0.95, column);
    win = 0.0; recess = 0.0; balcony = 0.0;
  }
  c = mix(c, c * (0.7 - 0.38 * smoothstep(0.55, 1.0, f)), recess);
  c = mix(c, c * 1.07, balcony);
  c = mix(c, c * 0.55, band * step(abs(f - 0.34), 0.015));
  c = mix(c, c * 0.72, slabLine);
  float shutter = step(0.22, cell) * step(cell, 0.4);
  vec3 pane = mix(mix(GLASS_DARK, GLASS_SKY, 0.35 + 0.3 * hash12(vec2(seed, bay))), GLASS_DARK, uNight);
  vec3 opening = mix(pane, vec3(0.78, 0.74, 0.66) * (0.8 + 0.2 * hash12(vec2(bay, seed))), shutter);
  c = mix(c, opening, win);
  glass = win * (1.0 - shutter);
  vec2 id = vec2(bay + seed * 91.0, floorIdx + seed * 37.0);
  lit = glass * step(1.0 - uLitFrac, cell) * windowLight(id);
  float slats = step(0.45, fract(v * 8.0)) * step(0.3, cell); // light through the closed trisim slats
  lit += win * shutter * slats * uNight * 0.22 * windowLight(id);
  return c;
}

vec3 glassWalls(vec3 c, float u, float v, float seed, float top, inout float glass, inout vec3 lit) {
  float fy = v / floorHeight(top);
  float f = fract(fy), fb = fract(u / 1.5);
  float mullion = clamp(step(f, 0.035) + step(fb, 0.05), 0.0, 1.0);
  float spandrel = step(0.76, f);
  float cell = hash12(vec2(floor(u / 1.5) + seed * 91.0, floor(fy) + seed * 37.0));
  vec3 pane = mix(mix(c, GLASS_SKY * 1.25, 0.4), GLASS_DARK, uNight * 0.85);
  vec3 out3 = mix(pane, c * 0.62, spandrel);
  out3 = mix(out3, c * 0.45, mullion);
  glass = (1.0 - spandrel) * (1.0 - mullion);
  float floorId = floor(fy) + seed * 37.0;
  float office = step(1.0 - (uLitFrac - 0.025) * 0.6, hash12(vec2(floorId, seed * 13.0))); // whole office floors at night
  vec3 officeLight = mix(LIT_DAY, vec3(1.0, 0.86, 0.66) * (0.45 + 0.3 * hash12(vec2(seed, floorId))), uNight);
  lit = glass * max(step(1.0 - uLitFrac * 0.6, cell) * 0.5 * windowLight(vec2(floor(u / 1.5) + seed * 91.0, floorId)), office * officeLight);
  return out3;
}

vec3 targetWalls(vec3 c, float u, float v, float seed, float len, float top, inout float glass, inout vec3 lit) {
  float floorIdx = floor(v / floorHeight(top)), bay = floor(u / 4.5);
  float pick = hash12(vec2(bay * 3.1 + 7.0, floorIdx * 5.3 + 1.0));
  vec3 palette = pick < 0.25 ? vec3(1.0, 0.76, 0.2) : pick < 0.5 ? vec3(0.2, 0.72, 0.72) : pick < 0.75 ? vec3(1.0, 0.45, 0.35) : vec3(0.55, 0.5, 0.9);
  vec3 base = mix(c, palette, 0.75);
  return plasterWalls(base, u, v, seed, len, top, false, glass, lit);
}

// roof: 1 on horizontal roofs (they pool water), 0.6 on parapets, 0 on walls.
vec3 facade(vec3 c, vec4 fac, vec3 wp, inout float glass, inout vec3 lit, inout float roof) {
  float type = floor(fac.w + 0.0005);
  float len = fract(fac.w) * 1000.0;
  float u = fac.x, seed = fac.y, top = fac.z, v = wp.y;
  if (type < 0.5) return plasterWalls(c, u, v, seed, len, top, true, glass, lit);
  if (type < 1.5) return plasterWalls(c, u, v, seed, len, top, false, glass, lit);
  if (type < 2.5) return glassWalls(c, u, v, seed, top, glass, lit);
  if (type < 3.5) return targetWalls(c, u, v, seed, len, top, glass, lit);
  if (type < 4.5) {
    roof = 1.0;
    float grime = fbm(wp.xz * 0.35 + seed * 10.0);
    return c * (0.9 + 0.14 * grime) * (0.96 + 0.06 * vnoise(wp.xz * 3.0));
  }
  if (type < 5.5) { roof = 0.6; return c * 0.97; }
  roof = 1.0;
  float stripe = step(0.5, fract((wp.x + wp.z * 0.3) / 7.0));
  return mix(vec3(1.0, 0.8, 0.2), vec3(1.0, 0.42, 0.32), stripe) * (0.9 + 0.1 * vnoise(wp.xz * 2.0));
}
`;
