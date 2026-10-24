// The land: ground, areas, roads, buildings, trees, street lamps and the procedural fringe, plus the physics queries over them.
import * as THREE from 'three';
import type { City, CreateCity, Quality } from '../contracts';
import { buildBuildings } from './buildings';
import { buildFlats } from './flats';
import { buildFringe } from './fringe';
import { ChunkGrid } from './geom';
import { buildLamps, LAMP } from './lamps';
import { CityPhysics } from './physics';
import { createCityUniforms } from './shaders';
import { buildTrees } from './trees';

const CHUNK = 900;
/** Per-tier knobs; everything else stays identical so the city reads the same on every device. The creation tier's
 *  densities also decide how many rooftop units and fringe boxes exist, so a later upgrade cannot exceed them. */
const QUALITY: Record<Quality, { treeDensity: number; treeRange: number; clutter: number; clutterRange: number; fringe: number; lampMinHw: number }> = {
  low: { treeDensity: 0.35, treeRange: 1000, clutter: 0.35, clutterRange: 450, fringe: 0.4, lampMinHw: 5.5 }, // arterials, ~9k lamps
  medium: { treeDensity: 0.65, treeRange: 1600, clutter: 0.7, clutterRange: 700, fringe: 0.7, lampMinHw: 3.9 }, // + tertiary, ~17k
  high: { treeDensity: 1, treeRange: 2400, clutter: 1, clutterRange: 1000, fringe: 1, lampMinHw: LAMP.minHw }, // + residential, ~37k
};
const { smoothstep, lerp } = THREE.MathUtils;

/** Returns a setter that moves a built-in material from its dry look toward a wet one (glossier, darker). */
function wetLook(m: THREE.MeshStandardMaterial, wetRoughness: number, darken: number): (wet: number) => void {
  const dryRoughness = m.roughness, dryColor = m.color.clone();
  return (wet) => {
    m.roughness = lerp(dryRoughness, wetRoughness, wet);
    m.color.copy(dryColor).multiplyScalar(1 - darken * wet);
  };
}

export const createCity: CreateCity = (data, opts): City => {
  const started = performance.now();
  const uniforms = createCityUniforms();
  const grid = new ChunkGrid(CHUNK);
  const built = QUALITY[opts.quality];
  const buildings = buildBuildings(data, grid, uniforms, built.clutter);
  const physics = new CityPhysics(data, buildings.footprints);
  const flats = buildFlats(data, grid, uniforms);
  const trees = buildTrees(data, grid, physics);
  const fringe = buildFringe(data, built.fringe);
  const lamps = buildLamps(flats.lampStations, uniforms);

  const group = new THREE.Group();
  group.name = 'city';
  group.add(flats.ground, fringe.mesh, lamps.points);
  const nearGroups: THREE.Group[] = []; // per chunk: trees and rooftop clutter, shown only near the camera
  for (let i = 0; i < grid.count; i++) {
    const near = trees.byChunk[i];
    const clutter = new THREE.Group();
    for (const c of [buildings.heaters[i], buildings.acUnits[i]]) if (c) clutter.add(c.mesh);
    near.add(clutter);
    near.userData.clutter = clutter;
    nearGroups.push(near);
    group.add(near);
    for (const m of [flats.chunks[i], buildings.chunks[i]]) if (m) group.add(m);
  }
  const wetLooks = [
    wetLook(flats.ground.material, 0.5, 0.3),
    wetLook(buildings.clutterMaterial, 0.3, 0.15),
    wetLook(fringe.mesh.material, 0.55, 0.25),
    ...trees.materials.map((m) => wetLook(m, 0.6, 0.18)),
  ];

  let tier = QUALITY[opts.quality];
  const setQuality = (q: Quality) => {
    tier = QUALITY[q];
    trees.setDensity(tier.treeDensity);
    fringe.setFraction(tier.fringe);
    for (const list of [buildings.heaters, buildings.acUnits]) for (const c of list) if (c) c.mesh.count = Math.min(c.mesh.instanceMatrix.count, Math.round(c.full * tier.clutter));
    lamps.setMinHalfWidth(tier.lampMinHw);
    uniforms.uPoolMinHw.value = tier.lampMinHw;
  };
  setQuality(opts.quality);
  console.info(`city built in ${(performance.now() - started).toFixed(0)} ms`);

  let appliedWet = 0, appliedRain = 0;
  const camXZ = new THREE.Vector3();
  return {
    group,
    surfaceAt: (x, z, belowY) => physics.surfaceAt(x, z, belowY),
    collide: (center, radius) => physics.collide(center, radius),
    update(camera) {
      const t = performance.now() / 1000;
      flats.time.value = t;
      trees.time.value = t;
      camera.getWorldPosition(camXZ);
      const treeRange = tier.treeRange + CHUNK * 0.71, clutterRange = tier.clutterRange + CHUNK * 0.71;
      for (let i = 0; i < nearGroups.length; i++) {
        const [cx, cz] = grid.center(i);
        const d = Math.hypot(cx - camXZ.x, cz - camXZ.z);
        nearGroups[i].visible = d < treeRange;
        (nearGroups[i].userData.clutter as THREE.Group).visible = d < clutterRange;
      }
    },
    setQuality,
    applyLighting(l) {
      const night = smoothstep(l.night, 0.15, 0.85); // the sunset row (0.15) keeps today's look
      uniforms.uNight.value = night;
      uniforms.uLitFrac.value = 0.025 + 0.35 * smoothstep(l.night, 0.05, 0.85); // about 60% of windows at full night
      uniforms.uWet.value = l.wetness;
      uniforms.uOvercast.value = l.overcast;
      lamps.points.visible = night > 0.02;
      if (Math.abs(l.wetness - appliedWet) >= 1e-3) {
        appliedWet = l.wetness;
        for (const apply of wetLooks) apply(appliedWet);
      }
      if (Math.abs(l.rain - appliedRain) >= 1e-3) {
        appliedRain = l.rain;
        trees.setWind(1 + 0.8 * appliedRain);
      }
    },
  };
};
