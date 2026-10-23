// Converts raw Overpass tiles (data-raw/) into compact binaries in public/data/.
// Format is decoded only by src/world/data.ts; see that file for the layout.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { LAT0, LON0, project } from '../src/geo.ts';

const RAW = new URL('../data-raw/', import.meta.url);
const OUT = new URL('../public/data/', import.meta.url);
const Q = 2; // coordinates stored as int16 in half-meter units

const TARGETS = {
  school: { lat: 32.111514, lon: 34.819389, buildingName: 'David Yelin School' },
  gan: { lat: 32.109808, lon: 34.818717, clearRadius: 16 }, // not mapped in OSM; the game places its own building here
};

async function loadLayer(layer) {
  const files = (await readdir(RAW)).filter((f) => f.startsWith(layer + '_'));
  const seen = new Map();
  for (const f of files) {
    const { elements } = JSON.parse(await readFile(new URL(f, RAW), 'utf8'));
    for (const el of elements) seen.set(el.type + el.id, el);
  }
  return [...seen.values()];
}

const toXZ = (geom) => geom.flatMap((p) => project(p.lat, p.lon));
const area2 = (r) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return a; };
function cleanRing(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) {
    const x = Math.round(flat[i] * Q) / Q, z = Math.round(flat[i + 1] * Q) / Q;
    const n = out.length;
    if (n && out[n - 2] === x && out[n - 1] === z) continue;
    out.push(x, z);
  }
  if (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
  return out.length >= 6 ? out : null;
}
function orient(ring, positive) {
  if ((area2(ring) > 0) === positive) return ring;
  const r = [];
  for (let i = ring.length - 2; i >= 0; i -= 2) r.push(ring[i], ring[i + 1]);
  return r;
}

// Joins open member ways of a multipolygon into closed rings.
function assembleRings(ways) {
  const segs = ways.map((w) => w.slice());
  const rings = [];
  while (segs.length) {
    let cur = segs.shift();
    let guard = 0;
    while (guard++ < 1000) {
      const [hx, hz] = [cur[0], cur[1]];
      const [tx, tz] = [cur[cur.length - 2], cur[cur.length - 1]];
      if (hx === tx && hz === tz && cur.length > 4) break;
      const i = segs.findIndex((s) => (s[0] === tx && s[1] === tz) || (s[s.length - 2] === tx && s[s.length - 1] === tz));
      if (i < 0) break;
      let s = segs.splice(i, 1)[0];
      if (!(s[0] === tx && s[1] === tz)) { const r = []; for (let k = s.length - 2; k >= 0; k -= 2) r.push(s[k], s[k + 1]); s = r; }
      cur = cur.concat(s.slice(2));
    }
    rings.push(cur);
  }
  return rings;
}

function polygonsOf(el) {
  if (el.type === 'way' && el.geometry) return [[toXZ(el.geometry)]];
  if (el.type !== 'relation' || !el.members) return [];
  const raw = (role) => el.members.filter((m) => m.type === 'way' && m.geometry && (m.role || 'outer') === role).map((m) => toXZ(m.geometry));
  const outers = assembleRings(raw('outer')), inners = assembleRings(raw('inner'));
  return outers.map((o, i) => (i === 0 ? [o, ...inners] : [o]));
}

const centroid = (r) => { let x = 0, z = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; } return [(2 * x) / r.length, (2 * z) / r.length]; };
for (const t of Object.values(TARGETS)) [t.x, t.z] = project(t.lat, t.lon);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const hash = (n) => { let x = n | 0; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

const BUILDING_KIND = { residential: 0, tower: 1, public: 2, religious: 3, industrial: 4, landmark: 5, target: 6 };
function classify(tags, height, footprint) {
  const b = tags.building ?? tags['building:part'];
  if (['church', 'mosque', 'synagogue', 'cathedral', 'chapel', 'temple'].includes(b) || tags.amenity === 'place_of_worship') return 'religious';
  if (tags.amenity === 'school' || tags.amenity === 'kindergarten' || ['school', 'kindergarten', 'university', 'hospital', 'public', 'civic', 'government', 'train_station'].includes(b)) return 'public';
  if (['industrial', 'warehouse', 'hangar', 'garage', 'garages', 'roof', 'shed', 'service'].includes(b)) return 'industrial';
  if (height >= 45) return 'tower';
  if (tags.historic || tags.tourism === 'attraction') return 'landmark';
  return footprint > 2500 && height > 20 ? 'tower' : 'residential';
}
function heightOf(tags, id, footprint) {
  const h = num(tags.height) ?? num(tags['building:height']);
  const levels = num(tags['building:levels']);
  const roofLevels = num(tags['roof:levels']) ?? 0;
  if (h) return h;
  if (levels) return (levels + roofLevels) * 3.3 + 1;
  const b = tags.building;
  if (['garage', 'garages', 'shed', 'roof', 'kiosk', 'hut', 'carport'].includes(b)) return 3 + hash(id) * 1.5;
  if (['industrial', 'warehouse'].includes(b)) return 7 + hash(id) * 6;
  // Typical Tel Aviv: 3-4 floors on pillars, taller for big footprints.
  const base = footprint > 1200 ? 18 : footprint > 500 ? 14 : 11;
  return base + hash(id) * 6;
}

function writeRings(buf, rings) {
  buf.u8(rings.length);
  for (const r of rings) { buf.u16(r.length / 2); for (const v of r) buf.i16(Math.round(v * Q)); }
}
class Buf {
  constructor() { this.a = new DataView(new ArrayBuffer(1 << 26)); this.o = 0; }
  u8(v) { this.a.setUint8(this.o, v); this.o += 1; }
  u16(v) { this.a.setUint16(this.o, v, true); this.o += 2; }
  i16(v) { this.a.setInt16(this.o, Math.max(-32768, Math.min(32767, v)), true); this.o += 2; }
  u32(v) { this.a.setUint32(this.o, v, true); this.o += 4; }
  bytes() { return new Uint8Array(this.a.buffer, 0, this.o); }
}

async function buildBuildings() {
  const els = await loadLayer('buildings');
  const parts = els.filter((e) => e.tags?.['building:part']);
  const partOf = new Set();
  // Buildings described by parts render via parts only, so drop the outline when parts exist inside it.
  for (const p of parts) if (p.bounds) partOf.add(`${p.bounds.minlat.toFixed(3)},${p.bounds.minlon.toFixed(3)}`);
  const recs = [];
  for (const el of els) {
    const tags = el.tags ?? {};
    if (tags.building === 'construction' || tags['building:part'] === 'no') continue;
    for (const poly of polygonsOf(el)) {
      const rings = poly.map(cleanRing).filter(Boolean);
      if (!rings.length) continue;
      rings[0] = orient(rings[0], true);
      for (let i = 1; i < rings.length; i++) rings[i] = orient(rings[i], false);
      const footprint = area2(rings[0]) / 2;
      if (footprint < 12) continue;
      const height = clamp(heightOf(tags, el.id, footprint), 2.5, 400);
      const minHeight = num(tags.min_height) ?? (num(tags['building:min_level']) ?? 0) * 3.3;
      const [cx, cz] = centroid(rings[0]);
      if (Object.values(TARGETS).some((t) => t.clearRadius && Math.hypot(cx - t.x, cz - t.z) < t.clearRadius)) continue;
      const isTarget = Object.values(TARGETS).some((t) => t.buildingName && tags['name:en'] === t.buildingName);
      const kind = isTarget ? 'target' : classify(tags, height, footprint);
      recs.push({ rings, height, minHeight: Math.min(minHeight, height - 1), kind, id: el.id, isPart: !!tags['building:part'] });
    }
  }
  const buf = new Buf();
  buf.u32(recs.length);
  for (const r of recs) {
    buf.u16(Math.round(r.height * 10));
    buf.u16(Math.round(Math.max(0, r.minHeight) * 10));
    buf.u8(BUILDING_KIND[r.kind]);
    buf.u8(Math.floor(hash(r.id * 7 + 3) * 256));
    writeRings(buf, r.rings);
  }
  await writeFile(new URL('buildings.bin', OUT), buf.bytes());
  console.log('buildings', recs.length, (buf.o / 1e6).toFixed(2) + 'MB');
  return recs;
}

const ROAD_KIND = {
  motorway: [0, 24], motorway_link: [0, 10], trunk: [1, 18], trunk_link: [1, 9], primary: [2, 15], primary_link: [2, 8],
  secondary: [3, 12], secondary_link: [3, 7], tertiary: [4, 10], tertiary_link: [4, 7], residential: [5, 7.5], unclassified: [5, 7],
  living_street: [5, 6], service: [6, 4.5], pedestrian: [7, 6], footway: [7, 2.5], path: [7, 2.2], cycleway: [7, 2.2], steps: [7, 2.5],
  track: [6, 3.5], rail: [8, 4], light_rail: [8, 4], subway: [8, 4],
};
async function buildRoads() {
  const els = await loadLayer('roads');
  const buf = new Buf();
  let n = 0;
  const body = [];
  for (const el of els) {
    if (el.type !== 'way' || !el.geometry) continue;
    const t = el.tags ?? {};
    if (t.tunnel === 'yes' || t.layer?.startsWith('-') || t.area === 'yes') continue;
    const spec = ROAD_KIND[t.highway] ?? ROAD_KIND[t.railway];
    if (!spec) continue;
    const pts = cleanRing(toXZ(el.geometry).concat([NaN, NaN])); // NaN sentinel stops closed-ring trimming
    const line = pts ? pts.slice(0, -2).filter((v) => !Number.isNaN(v)) : null;
    if (!line || line.length < 4) continue;
    const bridge = t.bridge === 'yes' || t.bridge === 'viaduct' ? 1 : 0;
    body.push([spec[0], Math.round(spec[1] * 2), bridge, line]);
    n++;
  }
  buf.u32(n);
  for (const [kind, w2, bridge, line] of body) { buf.u8(kind); buf.u8(w2); buf.u8(bridge); writeRings(buf, [line]); }
  await writeFile(new URL('roads.bin', OUT), buf.bytes());
  console.log('roads', n, (buf.o / 1e6).toFixed(2) + 'MB');
}

const AREA_KIND = { park: 0, grass: 1, forest: 2, water: 3, beach: 4, pitch: 5, school: 6, parking: 7, cemetery: 8, plaza: 9, farmland: 10 };
function areaKind(t) {
  if (t.natural === 'water' || t.water || t.landuse === 'reservoir' || t.landuse === 'basin' || t.waterway === 'riverbank') return 'water';
  if (t.natural === 'beach' || t.natural === 'sand') return 'beach';
  if (t.natural === 'wood' || t.landuse === 'forest' || t.landuse === 'orchard') return 'forest';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'nature_reserve' || t.leisure === 'golf_course') return 'park';
  if (t.leisure === 'pitch' || t.leisure === 'stadium' || t.leisure === 'track') return 'pitch';
  if (t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'village_green' || t.natural === 'grassland' || t.natural === 'scrub' || t.leisure === 'playground' || t.landuse === 'recreation_ground') return 'grass';
  if (t.amenity === 'school' || t.amenity === 'kindergarten' || t.amenity === 'university') return 'school';
  if (t.amenity === 'parking') return 'parking';
  if (t.landuse === 'cemetery') return 'cemetery';
  if (t.landuse === 'farmland' || t.landuse === 'allotments') return 'farmland';
  return null;
}
async function buildAreas() {
  const els = await loadLayer('areas');
  const buf = new Buf();
  const recs = [];
  const rivers = [];
  const coast = [];
  for (const el of els) {
    const t = el.tags ?? {};
    if (t.natural === 'coastline' && el.type === 'way') { coast.push(toXZ(el.geometry)); continue; }
    if (el.type === 'way' && (t.waterway === 'river' || t.waterway === 'stream' || t.waterway === 'canal') && el.geometry) {
      rivers.push([t.waterway === 'river' ? 1 : 0, toXZ(el.geometry)]);
      continue;
    }
    const kind = areaKind(t);
    if (!kind) continue;
    for (const poly of polygonsOf(el)) {
      const rings = poly.map(cleanRing).filter(Boolean);
      if (!rings.length) continue;
      rings[0] = orient(rings[0], true);
      for (let i = 1; i < rings.length; i++) rings[i] = orient(rings[i], false);
      if (area2(rings[0]) / 2 < 30) continue;
      recs.push([AREA_KIND[kind], rings]);
    }
  }
  buf.u32(recs.length);
  for (const [k, rings] of recs) { buf.u8(k); writeRings(buf, rings); }
  buf.u32(rivers.length);
  for (const [major, line] of rivers) { buf.u8(major); writeRings(buf, [line]); }
  await writeFile(new URL('areas.bin', OUT), buf.bytes());
  console.log('areas', recs.length, 'rivers', rivers.length, (buf.o / 1e6).toFixed(2) + 'MB');
  return coast;
}

// Sea polygon: coastline chained north to south, extended far beyond the data box, closed out to the west.
function buildSea(coastWays) {
  const chains = assembleRings(coastWays);
  const main = chains.sort((a, b) => b.length - a.length)[0];
  // OSM coastline has land on the left; walking it here goes south to north. Make it north to south.
  let line = main;
  if (line[1] > line[line.length - 1]) { /* already north (smaller z) to south */ } else {
    const r = []; for (let k = line.length - 2; k >= 0; k -= 2) r.push(line[k], line[k + 1]); line = r;
  }
  const FAR = 40000;
  const ext = (x0, z0, x1, z1) => { const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1; return [x1 + (dx / l) * FAR, z1 + (dz / l) * FAR]; };
  const n = line.length;
  const head = ext(line[4], line[5], line[0], line[1]);
  const tail = ext(line[n - 6], line[n - 5], line[n - 2], line[n - 1]);
  const ring = [head[0], head[1], ...line, tail[0], tail[1], -FAR * 1.5, tail[1], -FAR * 1.5, head[1]];
  return { coast: line.map((v) => Math.round(v * Q) / Q), sea: ring.map((v) => Math.round(v)) };
}

async function buildTrees() {
  const els = await loadLayer('trees');
  const out = [];
  for (const el of els) if (el.type === 'node') out.push(...project(el.lat, el.lon).map((v) => Math.round(v * Q)));
  const arr = new Int16Array(out);
  await writeFile(new URL('trees.bin', OUT), new Uint8Array(arr.buffer));
  console.log('trees', out.length / 2);
}

await mkdir(OUT, { recursive: true });
const recs = await buildBuildings();
await buildRoads();
const coastWays = await buildAreas();
await buildTrees();
const { coast, sea } = buildSea(coastWays);
const targets = {};
for (const [key, t] of Object.entries(TARGETS)) {
  const b = recs.find((r) => r.kind === 'target' && t.buildingName);
  targets[key] = { x: Math.round(t.x * 10) / 10, z: Math.round(t.z * 10) / 10, building: t.buildingName && b ? { ring: b.rings[0], height: b.height } : null };
}
await writeFile(new URL('world.json', OUT), JSON.stringify({ origin: { lat: LAT0, lon: LON0 }, coast, sea, targets }));
console.log('targets', JSON.stringify(Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, { x: v.x, z: v.z, h: v.building?.height }]))));
