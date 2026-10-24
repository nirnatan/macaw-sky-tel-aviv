import * as THREE from 'three';
import type { CreateLandmarks, LandingSpot, TargetId } from '../../contracts';
import { createAmbient } from './ambient';
import { createBeacon, type Beacon } from './beacon';
import { createCelebration } from './celebration';
import { pointScale } from './fx';
import { createGan, GAN_PAD_RADIUS, GAN_ROOF_CENTER, GAN_ROOF_RADIUS } from './gan';
import { moodOf, type Mood } from './mood';
import { createRingView } from './rings';
import { buildRoute, passesThrough } from './route';
import { createSchoolDecor, roofStats } from './school';

export const createLandmarks: CreateLandmarks = (data, { scene, quality }) => {
  const group = new THREE.Group();
  group.name = 'landmarks';
  scene.add(group);
  const shadows = quality !== 'low';

  const school = data.targets.school;
  const roof = school.building?.height ?? 0;
  const stats = school.building ? roofStats(school.building.ring) : { center: new THREE.Vector2(school.x, school.z), inscribed: 12, coverRadius: 18 };
  const schoolDecor = school.building ? createSchoolDecor(school.building.ring, roof, stats, shadows) : null;

  const gan = createGan(data, shadows);
  group.add(gan.group);

  const spots: LandingSpot[] = [
    { id: 'school', nameHe: 'ביה״ס דוד ילין', nameEn: 'David Yellin School', position: new THREE.Vector3(stats.center.x, roof, stats.center.y), radius: stats.coverRadius },
    { id: 'gan', nameHe: 'גן הדר', nameEn: 'Gan Hadar', position: gan.group.localToWorld(GAN_ROOF_CENTER.clone()), radius: GAN_ROOF_RADIUS },
  ];
  const beacons: Record<TargetId, Beacon> = {
    school: createBeacon({
      position: spots[0].position, padRadius: Math.min(stats.inscribed * 0.92, 12), signHeight: 26, signLift: 20, color: '#ffa31a',
      sign: { nameHe: spots[0].nameHe, nameEn: spots[0].nameEn, accent: '#f29e0c', board: ['#ffe47a', '#ffbf2e'], ink: '#3b1f5c', icon: 'star' },
    }),
    gan: createBeacon({
      position: spots[1].position, padRadius: GAN_PAD_RADIUS, signHeight: 22, signLift: 2, color: '#ff2fc0',
      sign: { nameHe: spots[1].nameHe, nameEn: spots[1].nameEn, accent: '#ff3d9a', board: ['#ffc6e6', '#ff8fcb'], ink: '#3b1f5c', icon: 'heart' },
    }),
  };

  const route = buildRoute(data.buildings);
  const rings = route.map((r) => ({ position: r.position, collected: false }));
  const ringView = createRingView(route);
  const celebration = createCelebration(quality === 'low' ? 3000 : 6000);
  const ambient = createAmbient(data, quality);

  group.add(...(schoolDecor?.objects ?? []), ...beacons.school.objects, ...beacons.gan.objects, ...ringView.objects, ...celebration.objects, ...ambient.objects);

  let time = 0;
  const mood: Mood = { glow: 0, gray: 0, wet: 0, rain: 0, daylight: 1 };
  const viewer = new THREE.Vector3();
  const spotOf = (id: TargetId) => spots.find((s) => s.id === id)!;

  return {
    group,
    spots,
    rings,
    surfaceAt: (x, z, belowY = Infinity) => gan.surfaceAt(x, z, belowY),
    collectRings(prev, curr) {
      const hits: number[] = [];
      route.forEach((r, i) => {
        if (rings[i].collected || !passesThrough(prev, curr, r)) return;
        rings[i].collected = true;
        ringView.pop(i, time);
        celebration.pop(r.position, time);
        hits.push(i);
      });
      return hits;
    },
    setFound: (id) => beacons[id].setFound(time),
    burst: (id) => celebration.burst(spotOf(id).position, id === 'gan' ? 'heart' : 'star', time, viewer),
    applyLighting(l) {
      moodOf(l, mood);
      beacons.school.applyLighting(mood);
      beacons.gan.applyLighting(mood);
      schoolDecor?.applyLighting(mood);
      gan.applyLighting(mood);
      ringView.applyLighting(mood);
      ambient.applyLighting(mood);
    },
    update(dt, camera, bird) {
      time += dt;
      camera.getWorldPosition(viewer);
      const scale = pointScale(camera);
      beacons.school.update(dt, time, camera);
      beacons.gan.update(dt, time, camera);
      schoolDecor?.update(time);
      gan.update(time, scale);
      ringView.update(time, rings);
      celebration.update(time, camera);
      ambient.update(dt, time, bird, scale);
    },
  };
};
