// World frame: meters, +x east, +z south (north is -z), +y up. Origin near the middle of the data box.
export const LAT0 = 32.085;
export const LON0 = 34.8;
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);

export function project(lat: number, lon: number): [x: number, z: number] {
  return [(lon - LON0) * M_PER_DEG_LON, -(lat - LAT0) * M_PER_DEG_LAT];
}
