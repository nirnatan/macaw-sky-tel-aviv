import * as THREE from 'three';
import type { Surface } from '../../contracts';
import type { Place, PlaceStyle } from '../../places';
import type { CityData, Target } from '../../world/data';
import type { BurstShape } from './celebration';
import { createGan } from './gan';
import { createHomeDecor } from './home';
import type { Mood } from './mood';
import { roofOf, type Roof } from './roof';
import { createSchoolDecor } from './school';
import type { SignIcon } from './sign';

/** Where the bird lands on a place, and how big its pulsing landing ring is. */
export interface Site { position: THREE.Vector3; radius: number; padRadius: number }

/** The art a style adds around its place. */
export interface Decor {
  readonly objects: THREE.Object3D[];
  /** Walkable surfaces the decor adds; absent when it only dresses a city roof. */
  surfaceAt?(x: number, z: number, belowY: number): Surface | null;
  applyLighting(m: Mood): void;
  update(time: number, pointScale: number): void;
}

interface Style {
  icon: SignIcon;
  burst: BurstShape;
  signHeight: number; // pointer tip height above the landing spot
  dress(place: Place, target: Target, data: CityData, castShadow: boolean): { site: Site; decor: Decor };
}

/** Building-backed places land on the middle of their own roof, inside the largest circle that fits. */
const onRoof = (decorate: (roof: Roof, place: Place, castShadow: boolean) => Decor): Style['dress'] => (place, target, _data, castShadow) => {
  const roof = roofOf(place.id, target);
  const position = new THREE.Vector3(roof.center.x, roof.height, roof.center.y);
  return { site: { position, radius: roof.coverRadius, padRadius: roof.padRadius }, decor: decorate(roof, place, castShadow) };
};

export const STYLES: Record<PlaceStyle, Style> = {
  school: { icon: 'star', burst: 'star', signHeight: 26, dress: onRoof((roof, _place, castShadow) => createSchoolDecor(roof, castShadow)) },
  gan: { icon: 'heart', burst: 'heart', signHeight: 22, dress: (_place, target, data, castShadow) => createGan(data, target, castShadow) },
  home: { icon: 'house', burst: 'house', signHeight: 22, dress: onRoof((roof, place, castShadow) => createHomeDecor(roof, place.color, castShadow)) },
};
