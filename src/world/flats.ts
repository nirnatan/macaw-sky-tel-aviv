// Everything flat on the land: the ground polygon, area fills, road and rail ribbons, rivers and the beach strip.
// One mesh per chunk shares a single material; a per-vertex surface type drives the look in the shader.
import * as THREE from 'three';
import type { AreaKind, CityData, Ring, RoadKind } from './data';
import { ChunkGrid, GeometryWriter, pointInRing, polylineLength, ringCentroid, triangulate } from './geom';
import { addLampStations, LAMP_POOL_GLSL } from './lamps';
import { RIVER_HALF_WIDTH } from './physics';
import { after, CITY_UNIFORMS_GLSL, type CityUniforms, srgb, withWorldPos } from './shaders';

const SURF = { fill: 0, asphalt: 1, pavement: 2, rail: 3, water: 4, vegetation: 5, sand: 6, concrete: 7 } as const;
type Surf = (typeof SURF)[keyof typeof SURF];
type Rgb = [number, number, number];

const AREA_STYLE: Record<AreaKind, { color: Rgb; type: Surf; y: number }> = {
  park: { color: srgb('#7a9f4a'), type: SURF.vegetation, y: 0.12 },
  grass: { color: srgb('#98a858'), type: SURF.vegetation, y: 0.12 },
  forest: { color: srgb('#4e7538'), type: SURF.vegetation, y: 0.12 },
  cemetery: { color: srgb('#8c9c5e'), type: SURF.vegetation, y: 0.12 },
  farmland: { color: srgb('#b9a66a'), type: SURF.vegetation, y: 0.12 },
  water: { color: srgb('#2e6b85'), type: SURF.water, y: 0.1 },
  beach: { color: srgb('#e6d4a8'), type: SURF.sand, y: 0.1 },
  pitch: { color: srgb('#5f9a4c'), type: SURF.fill, y: 0.14 },
  school: { color: srgb('#cdbfa6'), type: SURF.pavement, y: 0.12 },
  parking: { color: srgb('#8e8a84'), type: SURF.fill, y: 0.12 },
  plaza: { color: srgb('#d6c9b2'), type: SURF.pavement, y: 0.14 },
};
const ASPHALT = srgb('#5c5955');
const ROAD_STYLE: Record<RoadKind, { color: Rgb; type: Surf; sidewalk: number; y: number }> = {
  motorway: { color: ASPHALT, type: SURF.asphalt, sidewalk: 0, y: 0.26 },
  trunk: { color: ASPHALT, type: SURF.asphalt, sidewalk: 0, y: 0.26 },
  primary: { color: ASPHALT, type: SURF.asphalt, sidewalk: 2.5, y: 0.25 },
  secondary: { color: ASPHALT, type: SURF.asphalt, sidewalk: 2.5, y: 0.25 },
  tertiary: { color: ASPHALT, type: SURF.asphalt, sidewalk: 2.2, y: 0.24 },
  residential: { color: srgb('#625f5a'), type: SURF.asphalt, sidewalk: 2.0, y: 0.24 },
  service: { color: srgb('#6b6762'), type: SURF.asphalt, sidewalk: 0, y: 0.22 },
  footway: { color: srgb('#cbbfa8'), type: SURF.pavement, sidewalk: 0, y: 0.2 },
  rail: { color: srgb('#7d7368'), type: SURF.rail, sidewalk: 0, y: 0.3 },
};
const RIVER_COLOR = srgb('#2f6e86');
const BRIDGE_CONCRETE = srgb('#b9b1a3');
const BRIDGE_HEIGHT = 5;
const GROUND_RADIUS = 13000;

const LAYOUT = [{ name: 'position', size: 3 }, { name: 'color', size: 3 }, { name: 'aSurf', size: 4 }];

export interface Flats {
  ground: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  chunks: (THREE.Mesh | null)[];
  time: { value: number };
  lampStations: number[]; // [x, y, z, paved half width] per street lamp
}

export function buildFlats(data: CityData, grid: ChunkGrid, uniforms: CityUniforms): Flats {
  const time = { value: 0 };
  const writers: GeometryWriter[] = Array.from({ length: grid.count }, () => new GeometryWriter(LAYOUT, 256));
  const writerAt = (x: number, z: number) => writers[grid.indexOf(x, z)];

  for (const a of data.areas) {
    const style = AREA_STYLE[a.kind];
    const [cx, cz] = ringCentroid(a.rings[0]);
    fillPolygon(writerAt(cx, cz), a.rings, style.y, style.color, style.type);
  }
  const lampStations: number[] = [];
  for (const r of data.roads) {
    const style = ROAD_STYLE[r.kind];
    const flat = () => style.y;
    const total = r.bridge ? polylineLength(r.pts) : 0;
    const yAt = r.bridge ? (s: number) => style.y + BRIDGE_HEIGHT * Math.min(1, Math.min(s, total - s) / Math.min(40, total / 2)) : flat;
    ribbon(writerAt, grid, r.pts, r.width / 2 + style.sidewalk, r.width / 2, style.color, style.type, yAt, r.bridge);
    if (style.type === SURF.asphalt) addLampStations(lampStations, r.pts, r.width / 2, yAt);
  }
  for (const r of data.rivers) {
    const hw = r.major ? RIVER_HALF_WIDTH.major : RIVER_HALF_WIDTH.minor;
    ribbon(writerAt, grid, r.pts, hw, hw, RIVER_COLOR, SURF.water, () => 0.16, false);
  }
  beachStrip(writerAt, grid, data.coast);

  const material = flatsMaterial(time, uniforms);
  const chunks = writers.map((w) => {
    const g = w.toGeometry();
    if (!g) return null;
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    return m;
  });
  return { ground: buildGround(data.coast), chunks, time, lampStations };
}


function fillPolygon(w: GeometryWriter, rings: Ring[], y: number, color: Rgb, type: Surf): void {
  const base = w.vertexCount;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) w.vertex(r[i], y, r[i + 1], color[0], color[1], color[2], 0, 0, type, 0);
  const tris = triangulate(rings);
  for (let i = 0; i < tris.length; i += 3) w.triUp(base + tris[i], base + tris[i + 1], base + tris[i + 2]);
}

/** Mitered ribbon along a polyline, split into chunk writers at segment midpoints so long roads cull per tile. */
function ribbon(
  writerAt: (x: number, z: number) => GeometryWriter, grid: ChunkGrid, pts: Ring, halfWidth: number, pavedHalf: number,
  color: Rgb, type: Surf, yAt: (s: number) => number, skirts: boolean,
): void {
  const n = pts.length / 2;
  if (n < 2) return;
  const lx = new Float64Array(n), lz = new Float64Array(n), rx = new Float64Array(n), rz = new Float64Array(n), s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const px = pts[2 * i], pz = pts[2 * i + 1];
    let ax = 0, az = 0, bx = 0, bz = 0;
    if (i > 0) { ax = px - pts[2 * i - 2]; az = pz - pts[2 * i - 1]; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l; s[i] = s[i - 1] + l; }
    if (i < n - 1) { bx = pts[2 * i + 2] - px; bz = pts[2 * i + 3] - pz; const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l; }
    if (i === 0) { ax = bx; az = bz; } else if (i === n - 1) { bx = ax; bz = az; }
    let tx = ax + bx, tz = az + bz;
    const tl = Math.hypot(tx, tz);
    if (tl < 1e-6) { tx = ax; tz = az; } else { tx /= tl; tz /= tl; }
    const nx = -tz, nz = tx;
    const miter = halfWidth / Math.max(0.5, nx * -az + nz * ax);
    lx[i] = px + nx * miter; lz[i] = pz + nz * miter; rx[i] = px - nx * miter; rz[i] = pz - nz * miter;
  }
  let w: GeometryWriter | null = null, prevL = 0, prevR = 0, chunk = -1;
  for (let i = 0; i < n - 1; i++) {
    const c = grid.indexOf((pts[2 * i] + pts[2 * i + 2]) / 2, (pts[2 * i + 1] + pts[2 * i + 3]) / 2);
    if (c !== chunk || !w) {
      chunk = c;
      w = writerAt(pts[2 * i], pts[2 * i + 1]);
      const y = yAt(s[i]);
      prevL = w.vertex(lx[i], y, lz[i], color[0], color[1], color[2], s[i], halfWidth, type, pavedHalf);
      prevR = w.vertex(rx[i], y, rz[i], color[0], color[1], color[2], s[i], -halfWidth, type, pavedHalf);
    }
    const y = yAt(s[i + 1]);
    const L = w.vertex(lx[i + 1], y, lz[i + 1], color[0], color[1], color[2], s[i + 1], halfWidth, type, pavedHalf);
    const R = w.vertex(rx[i + 1], y, rz[i + 1], color[0], color[1], color[2], s[i + 1], -halfWidth, type, pavedHalf);
    w.triUp(prevL, prevR, L);
    w.triUp(prevR, R, L);
    if (skirts) {
      const y0 = yAt(s[i]);
      if (y0 > 0.5 || y > 0.5) addSkirt(w, lx[i], lz[i], y0, lx[i + 1], lz[i + 1], y, rx[i], rz[i], rx[i + 1], rz[i + 1]);
    }
    prevL = L; prevR = R;
  }
}
function addSkirt(w: GeometryWriter, ax: number, az: number, ay: number, bx: number, bz: number, by: number, cx: number, cz: number, dx: number, dz: number): void {
  const c = BRIDGE_CONCRETE, drop = 1.6;
  for (const [x0, z0, x1, z1] of [[ax, az, bx, bz], [cx, cz, dx, dz]]) {
    const a = w.vertex(x0, ay, z0, c[0], c[1], c[2], 0, 0, SURF.concrete, 0);
    const b = w.vertex(x1, by, z1, c[0], c[1], c[2], 0, 0, SURF.concrete, 0);
    const b2 = w.vertex(x1, by - drop, z1, c[0], c[1], c[2], 0, 0, SURF.concrete, 0);
    const a2 = w.vertex(x0, ay - drop, z0, c[0], c[1], c[2], 0, 0, SURF.concrete, 0);
    w.quad(a, b, b2, a2);
    w.quad(a, a2, b2, b); // both windings: skirts are seen from either side of the bridge
  }
}

/** Sand from the waterline to ~38 m inland along the whole coast inside the data box. */
function beachStrip(writerAt: (x: number, z: number) => GeometryWriter, grid: ChunkGrid, coast: Ring): void {
  const inland: number[] = [];
  const limit = grid.half + 100;
  for (let i = 0; i < coast.length; i += 2) {
    const x = coast[i], z = coast[i + 1];
    if (Math.abs(z) > limit || Math.abs(x) > limit) continue;
    const j = i + 2 < coast.length ? i + 2 : i - 2;
    let dx = coast[j] - x, dz = coast[j + 1] - z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    let nx = -dz, nz = dx;
    if (nx < 0) { nx = -nx; nz = -nz; } // land is east of the coast
    inland.push(x + nx * 15, z + nz * 15);
  }
  if (inland.length >= 4) ribbon(writerAt, grid, new Float32Array(inland), 23, 23, AREA_STYLE.beach.color, SURF.sand, () => 0.1, false);
}

/** Land polygon: the coast chain closed around the east side of a big square, so ground never covers the sea. */
function buildGround(coast: Ring): Flats['ground'] {
  const R = GROUND_RADIUS;
  const n = coast.length;
  const head = exitPoint(coast[0], coast[1], coast[0] - coast[4], coast[1] - coast[5], R);
  const tail = exitPoint(coast[n - 2], coast[n - 1], coast[n - 2] - coast[n - 6], coast[n - 1] - coast[n - 5], R);
  const ring: number[] = [head.x, head.z, ...coast, tail.x, tail.z];
  const corners = [[-R, -R], [R, -R], [R, R], [-R, R]];
  for (let k = 0; k < 4; k++) {
    const c = (Math.ceil(tail.t) + k) % 4;
    if (forwardDistance(tail.t, c) < forwardDistance(tail.t, head.t)) ring.push(corners[c][0], corners[c][1]);
  }
  const flat = new Float32Array(ring);
  if (pointInRing(-4500, 0, flat) || !pointInRing(0, 0, flat)) throw new Error('land polygon is inside out');
  const tris = triangulate([flat]);
  const positions = new Float32Array((flat.length / 2) * 3);
  for (let i = 0, v = 0; i < flat.length; i += 2, v += 3) { positions[v] = flat[i]; positions[v + 2] = flat[i + 1]; }
  const index: number[] = [];
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
    const up = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1]) - (flat[2 * c] - flat[2 * a]) * (flat[2 * b + 1] - flat[2 * a + 1]) < 0;
    index.push(a, up ? b : c, up ? c : b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, groundMaterial());
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
/** Where the ray from (px, pz) along (dx, dz) leaves the square of half size R, with its perimeter parameter t in [0, 4). */
function exitPoint(px: number, pz: number, dx: number, dz: number, R: number): { x: number; z: number; t: number } {
  let best = Infinity;
  for (const [nx, nz, c] of [[1, 0, R], [-1, 0, R], [0, 1, R], [0, -1, R]]) {
    const denom = nx * dx + nz * dz;
    if (denom <= 0) continue;
    const s = (c - (nx * px + nz * pz)) / denom;
    if (s < best) best = s;
  }
  const x = Math.max(-R, Math.min(R, px + dx * best)), z = Math.max(-R, Math.min(R, pz + dz * best));
  let t: number;
  if (Math.abs(z + R) < 1e-3) t = (x + R) / (2 * R);
  else if (Math.abs(x - R) < 1e-3) t = 1 + (z + R) / (2 * R);
  else if (Math.abs(z - R) < 1e-3) t = 2 + (R - x) / (2 * R);
  else t = 3 + (R - z) / (2 * R);
  return { x, z, t };
}
function forwardDistance(from: number, to: number): number { return (((to - from) % 4) + 4) % 4; }

function groundMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#c4b7a2', roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
  m.onBeforeCompile = (shader) => {
    withWorldPos(shader);
    shader.fragmentShader = after(shader.fragmentShader, 'color_fragment', /* glsl */ `
      vec2 gp = vWorldPos.xz;
      float broad = fbm(gp * 0.004);
      float fine = vnoise(gp * 0.25);
      diffuseColor.rgb *= (0.88 + 0.22 * broad) * (0.95 + 0.1 * fine);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.96, 1.0, 0.9), smoothstep(0.55, 0.8, fbm(gp * 0.0015 + 9.0)));`);
  };
  return m;
}

/** How much each surface type darkens and gains gloss when wet, indexed by SURF. */
const WETTABLE_GLSL = 'const float WETTABLE[8] = float[8](0.8, 1.0, 0.9, 0.6, 0.0, 0.35, 0.45, 0.75);\n';

function flatsMaterial(time: { value: number }, uniforms: CityUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    Object.assign(shader.uniforms, uniforms);
    withWorldPos(shader, CITY_UNIFORMS_GLSL + LAMP_POOL_GLSL + WETTABLE_GLSL);
    shader.vertexShader = after(shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aSurf;\nvarying vec4 vSurf;'), 'begin_vertex', 'vSurf = aSurf;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vSurf;\nuniform float uTime;');
    shader.fragmentShader = after(shader.fragmentShader, 'color_fragment', /* glsl */ `
      vec3 c = diffuseColor.rgb;
      vec2 wp = vWorldPos.xz;
      float type = vSurf.z, au = vSurf.x, av = abs(vSurf.y), hw = vSurf.w;
      float water = 0.0, puddleable = 0.0, pool = 0.0;
      if (type < 0.5) {
        c *= 0.94 + 0.12 * fbm(wp * 0.08);
      } else if (type < 1.5) {
        vec3 asphalt = c * (0.9 + 0.2 * vnoise(wp * 1.7)) * (0.94 + 0.12 * vnoise(wp * 0.05));
        vec3 side = vec3(0.56, 0.5, 0.42) * (0.95 + 0.1 * vnoise(wp * 0.9));
        float onSide = step(hw, av);
        float curb = onSide * step(av, hw + 0.3);
        c = mix(asphalt, side, onSide);
        c = mix(c, side * 0.7, curb);
        float paint = 0.0;
        if (hw > 4.4) {
          float dash = step(fract(au / 6.0), 0.5);
          paint += dash * step(av, 0.09);
          paint += step(hw - 0.5, av) * step(av, hw - 0.36);
          if (hw > 5.9) paint += dash * step(abs(av - hw * 0.5), 0.07);
        }
        c = mix(c, vec3(0.72, 0.7, 0.62), clamp(paint, 0.0, 1.0) * (1.0 - onSide));
        puddleable = 1.0 - onSide;
        pool = lampPool(au, vSurf.y, hw) * uNight;
      } else if (type < 2.5) {
        c *= 0.93 + 0.14 * vnoise(wp * 1.3);
        puddleable = 0.8;
      } else if (type < 3.5) {
        float rail = step(abs(av - 0.72), 0.07);
        float sleeper = step(fract(au / 0.7), 0.4) * step(av, 1.3);
        c = mix(c, c * 0.55, sleeper);
        c = mix(c, vec3(0.5, 0.46, 0.4), rail);
      } else if (type < 4.5) {
        water = 1.0;
        float ripple = vnoise(wp * 0.35 + uTime * 0.08) * 0.5 + vnoise(wp * 1.1 - uTime * 0.05) * 0.5;
        c *= 0.8 + 0.4 * ripple;
      } else if (type < 5.5) {
        float dryness = fbm(wp * 0.05);
        c = mix(c * vec3(1.08, 1.0, 0.72), c * vec3(0.78, 0.9, 0.7), dryness);
        c *= 0.9 + 0.2 * vnoise(wp * 0.6);
      } else if (type < 6.5) {
        c *= 0.95 + 0.1 * vnoise(wp * 0.4) + 0.05 * vnoise(wp * 3.0);
      } else {
        c *= 0.95 + 0.1 * vnoise(wp * 0.5);
      }
      float wet = uWet * WETTABLE[int(type + 0.5)];
      float puddle = puddleable * smoothstep(0.6, 0.66, fbm(wp * 0.07 + 31.0) + 0.05 * vnoise(wp * 0.8)) * smoothstep(0.35, 0.95, uWet);
      c *= 1.0 - 0.42 * wet;
      c = mix(c, c * 0.6, puddle);
      diffuseColor.rgb = c;`);
    shader.fragmentShader = after(shader.fragmentShader, 'roughnessmap_fragment', /* glsl */ `
      roughnessFactor = mix(roughnessFactor, 0.12, water);
      roughnessFactor = mix(roughnessFactor, mix(0.45, 0.2, puddleable), wet); // paving stays rougher than asphalt
      roughnessFactor = mix(roughnessFactor, 0.05, puddle);`);
    shader.fragmentShader = after(shader.fragmentShader, 'metalnessmap_fragment', /* glsl */ `
      metalnessFactor = mix(metalnessFactor, 0.55, water);
      metalnessFactor = mix(metalnessFactor, 0.35, puddle);`);
    shader.fragmentShader = after(shader.fragmentShader, 'emissivemap_fragment', /* glsl */ `
      totalEmissiveRadiance += water * vec3(0.02, 0.05, 0.07);
      totalEmissiveRadiance += pool * LAMP_RGB * diffuseColor.rgb * 2.4 / (1.0 + 2.0 * diffuseColor.rgb); // soft knee, so pale sidewalks glow without turning white
      mat2 toWorld = ribbonToWorld(wp, au, vSurf.y);
      if (uNight * wet > 0.001 && type > 0.5 && type < 1.5 && hw >= uPoolMinHw)
        totalEmissiveRadiance += lampGlints(toWorld, vWorldPos, au, vSurf.y, hw, roughnessFactor) * wet * uNight;`);
  };
  return m;
}
