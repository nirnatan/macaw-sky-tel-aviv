// The special places the kids find and land on. One row per place; everything else (data build, beacons,
// signs, HUD badges, compass, minimap pins, celebrations) reads this table.

export type PlaceFootprint =
  | { kind: 'osmName'; nameEn: string } // a mapped OSM building, found by its English name
  | { kind: 'containing' } // the OSM building that contains the address point
  | { kind: 'custom'; clearRadius: number }; // not mapped: the game builds its own here and clears this radius

export type PlaceStyle = 'school' | 'gan' | 'home';

export const PLACES = [
  {
    id: 'school', nameHe: 'ביה״ס דוד ילין', nameEn: 'David Yellin School', addressHe: 'קהילת ורשה 12',
    lat: 32.111514, lon: 34.819389, footprint: { kind: 'osmName', nameEn: 'David Yelin School' }, style: 'school', color: '#ffc23a',
  },
  {
    id: 'gan', nameHe: 'גן הדר', nameEn: 'Gan Hadar', addressHe: 'הדר יוסף 7',
    lat: 32.109808, lon: 34.818717, footprint: { kind: 'custom', clearRadius: 16 }, style: 'gan', color: '#ff5fb8',
  },
  {
    id: 'oldHome', nameHe: 'הבית הישן', nameEn: 'The Old House', addressHe: 'הכרם 8',
    lat: 32.0831674, lon: 34.7703857, footprint: { kind: 'containing' }, style: 'home', color: '#3fc6ff',
  },
  {
    id: 'newHome', nameHe: 'הבית החדש', nameEn: 'The New House', addressHe: 'קהילת ורשה 36',
    lat: 32.111873, lon: 34.82121, footprint: { kind: 'containing' }, style: 'home', color: '#5fe36a',
  },
] as const satisfies readonly {
  id: string; nameHe: string; nameEn: string; addressHe: string; lat: number; lon: number;
  footprint: PlaceFootprint; style: PlaceStyle; color: string;
}[];

export type Place = (typeof PLACES)[number];
export type TargetId = Place['id'];
export const PLACE_IDS = PLACES.map((p) => p.id) as TargetId[];
export const placeById = (id: TargetId) => PLACES.find((p) => p.id === id)!;
