// Decodes the binaries written by scripts/build-data.mjs.
// Rings are flat [x0, z0, x1, z1, ...] in meters (see src/geo.ts). Outer rings have positive
// shoelace sum (x_i*z_{i+1} - x_{i+1}*z_i), holes negative. Rings are not closed (no repeated first point).

export type Ring = Float32Array;

export const BUILDING_KINDS = ['residential', 'tower', 'public', 'religious', 'industrial', 'landmark', 'target'] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];
export interface Building { rings: Ring[]; height: number; minHeight: number; kind: BuildingKind; seed: number }

export const ROAD_KINDS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'footway', 'rail'] as const;
export type RoadKind = (typeof ROAD_KINDS)[number];
export interface Road { pts: Ring; kind: RoadKind; width: number; bridge: boolean }

export const AREA_KINDS = ['park', 'grass', 'forest', 'water', 'beach', 'pitch', 'school', 'parking', 'cemetery', 'plaza', 'farmland'] as const;
export type AreaKind = (typeof AREA_KINDS)[number];
export interface Area { rings: Ring[]; kind: AreaKind }
export interface River { pts: Ring; major: boolean }

export interface Target { x: number; z: number; building: { ring: number[]; height: number } | null }
export interface CityData {
  buildings: Building[];
  roads: Road[];
  areas: Area[];
  rivers: River[];
  trees: Float32Array; // flat [x, z, ...]
  coast: Ring; // coastline polyline, north to south
  sea: Ring; // sea polygon (coast extended 40 km and closed far west)
  targets: { school: Target; gan: Target };
}

class Reader {
  private o = 0;
  private v: DataView;
  constructor(buf: ArrayBuffer) { this.v = new DataView(buf); }
  u8() { return this.v.getUint8(this.o++); }
  u16() { const r = this.v.getUint16(this.o, true); this.o += 2; return r; }
  u32() { const r = this.v.getUint32(this.o, true); this.o += 4; return r; }
  rings(): Ring[] {
    const n = this.u8();
    const out: Ring[] = [];
    for (let r = 0; r < n; r++) {
      const len = this.u16() * 2;
      const ring = new Float32Array(len);
      for (let i = 0; i < len; i++) { ring[i] = this.v.getInt16(this.o, true) / 2; this.o += 2; }
      out.push(ring);
    }
    return out;
  }
}

const fetchBuf = (name: string) => fetch(`${import.meta.env.BASE_URL}data/${name}`).then((r) => {
  if (!r.ok) throw new Error(`failed to load ${name}: ${r.status}`);
  return r.arrayBuffer();
});

export async function loadCityData(): Promise<CityData> {
  const [b, r, a, t, world] = await Promise.all([
    fetchBuf('buildings.bin'), fetchBuf('roads.bin'), fetchBuf('areas.bin'), fetchBuf('trees.bin'),
    fetch(`${import.meta.env.BASE_URL}data/world.json`).then((res) => res.json()),
  ]);

  const br = new Reader(b);
  const buildings: Building[] = Array.from({ length: br.u32() }, () => {
    const height = br.u16() / 10, minHeight = br.u16() / 10, kind = BUILDING_KINDS[br.u8()], seed = br.u8() / 255;
    return { height, minHeight, kind, seed, rings: br.rings() };
  });

  const rr = new Reader(r);
  const roads: Road[] = Array.from({ length: rr.u32() }, () => {
    const kind = ROAD_KINDS[rr.u8()], width = rr.u8() / 2, bridge = rr.u8() === 1;
    return { kind, width, bridge, pts: rr.rings()[0] };
  });

  const ar = new Reader(a);
  const areas: Area[] = Array.from({ length: ar.u32() }, () => ({ kind: AREA_KINDS[ar.u8()], rings: ar.rings() }));
  const rivers: River[] = Array.from({ length: ar.u32() }, () => ({ major: ar.u8() === 1, pts: ar.rings()[0] }));

  const ti = new Int16Array(t);
  const trees = new Float32Array(ti.length);
  for (let i = 0; i < ti.length; i++) trees[i] = ti[i] / 2;

  return { buildings, roads, areas, rivers, trees, coast: new Float32Array(world.coast), sea: new Float32Array(world.sea), targets: world.targets };
}
