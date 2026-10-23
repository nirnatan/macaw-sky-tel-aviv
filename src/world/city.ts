// The land: ground, areas, roads, buildings, trees and the procedural fringe, plus the physics queries over them.
import * as THREE from 'three';
import type { City, CreateCity, Quality } from '../contracts';
import { buildBuildings } from './buildings';
import { buildFlats } from './flats';
import { buildFringe } from './fringe';
import { ChunkGrid } from './geom';
import { CityPhysics } from './physics';
import { buildTrees } from './trees';

const CHUNK = 900;
/** Per-tier knobs; everything else stays identical so the city reads the same on every device. */
const QUALITY: Record<Quality, { treeDensity: number; treeRange: number; clutter: number; clutterRange: number; fringe: number }> = {
  low: { treeDensity: 0.35, treeRange: 1000, clutter: 0.35, clutterRange: 450, fringe: 0.4 },
  medium: { treeDensity: 0.65, treeRange: 1600, clutter: 0.7, clutterRange: 700, fringe: 0.7 },
  high: { treeDensity: 1, treeRange: 2400, clutter: 1, clutterRange: 1000, fringe: 1 },
};

export const createCity: CreateCity = (data, opts): City => {
  const started = performance.now();
  const grid = new ChunkGrid(CHUNK);
  const buildings = buildBuildings(data, grid);
  const physics = new CityPhysics(data, buildings.footprints);
  const flats = buildFlats(data, grid);
  const trees = buildTrees(data, grid, physics);
  const fringe = buildFringe(data);

  const group = new THREE.Group();
  group.name = 'city';
  group.add(flats.ground, fringe.mesh);
  const nearGroups: THREE.Group[] = []; // per chunk: trees and rooftop clutter, shown only near the camera
  for (let i = 0; i < grid.count; i++) {
    const near = trees.byChunk[i];
    const clutter = new THREE.Group();
    for (const m of [buildings.heaters[i], buildings.acUnits[i]]) if (m) clutter.add(m);
    near.add(clutter);
    near.userData.clutter = clutter;
    nearGroups.push(near);
    group.add(near);
    for (const m of [flats.chunks[i], buildings.chunks[i]]) if (m) group.add(m);
  }

  let tier = QUALITY[opts.quality];
  const setQuality = (q: Quality) => {
    tier = QUALITY[q];
    trees.setDensity(tier.treeDensity);
    fringe.setFraction(tier.fringe);
    for (const list of [buildings.heaters, buildings.acUnits]) for (const m of list) if (m) m.count = Math.round(m.instanceMatrix.count * tier.clutter);
  };
  setQuality(opts.quality);
  console.info(`city built in ${(performance.now() - started).toFixed(0)} ms`);

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
  };
};
