import * as THREE from 'three';
import type { CreateLandmarks, LandingSpot, Surface, TargetId } from '../../contracts';
import { PLACES } from '../../places';
import { createAmbient } from './ambient';
import { createBeacon } from './beacon';
import { createCelebration } from './celebration';
import { pointScale } from './fx';
import { moodOf, type Mood } from './mood';
import { createRingView } from './rings';
import { buildRoute, passesThrough } from './route';
import { layoutSigns } from './sign-layout';
import { STYLES } from './styles';

export const createLandmarks: CreateLandmarks = (data, { scene, quality }) => {
  const group = new THREE.Group();
  group.name = 'landmarks';
  scene.add(group);
  const shadows = quality !== 'low';

  const places = PLACES.map((place) => {
    const style = STYLES[place.style];
    const { site, decor } = style.dress(place, data.targets[place.id], data, shadows);
    const spot: LandingSpot = { id: place.id, nameHe: place.nameHe, nameEn: place.nameEn, position: site.position, radius: site.radius };
    const beacon = createBeacon({
      position: site.position, padRadius: site.padRadius, signHeight: style.signHeight,
      sign: { nameHe: place.nameHe, nameEn: place.nameEn, color: place.color, icon: style.icon },
    });
    group.add(...decor.objects, ...beacon.objects);
    return { id: place.id, burst: style.burst, spot, decor, beacon };
  });
  const placeById = new Map(places.map((p) => [p.id, p]));
  const signs = places.map((p) => p.beacon.sign); // registry order is the stacking order

  const route = buildRoute(data.buildings);
  const rings = route.map((r) => ({ position: r.position, collected: false }));
  const ringView = createRingView(route);
  const celebration = createCelebration(quality === 'low' ? 3000 : 6000);
  const ambient = createAmbient(data, quality);
  group.add(...ringView.objects, ...celebration.objects, ...ambient.objects);

  let time = 0;
  const mood: Mood = { glow: 0, gray: 0, wet: 0, rain: 0, daylight: 1 };
  const viewer = new THREE.Vector3();
  const place = (id: TargetId) => placeById.get(id)!;

  return {
    group,
    spots: places.map((p) => p.spot),
    rings,
    surfaceAt(x, z, belowY = Infinity) {
      let best: Surface | null = null;
      for (const { decor } of places) {
        const s = decor.surfaceAt?.(x, z, belowY);
        if (s && (!best || s.height > best.height)) best = s;
      }
      return best;
    },
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
    setFound: (id) => place(id).beacon.setFound(time),
    burst(id) {
      const p = place(id);
      celebration.burst(p.spot.position, p.burst, time, viewer);
    },
    applyLighting(l) {
      moodOf(l, mood);
      for (const p of places) {
        p.beacon.applyLighting(mood);
        p.decor.applyLighting(mood);
      }
      ringView.applyLighting(mood);
      ambient.applyLighting(mood);
    },
    update(dt, camera, bird) {
      time += dt;
      camera.getWorldPosition(viewer);
      const scale = pointScale(camera);
      for (const p of places) {
        p.beacon.update(dt, time, camera);
        p.decor.update(time, scale);
      }
      layoutSigns(signs, camera, dt);
      ringView.update(time, rings);
      celebration.update(time, camera);
      ambient.update(dt, time, bird, scale);
    },
  };
};
