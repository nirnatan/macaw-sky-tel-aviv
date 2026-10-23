import type { AreaKind, BuildingKind, CityData, Ring, RoadKind } from '../world/data';

export interface CityMap {
  canvas: HTMLCanvasElement;
  minX: number;
  minZ: number;
  metersPerPixel: number;
  widthMeters: number;
  heightMeters: number;
}

const MAX_PIXELS = 2560;
const PADDING = 250;

const COLORS = {
  land: '#efe3c8',
  sea: '#69b8d2',
  surf: '#ffffff',
};

const AREA_COLORS: Partial<Record<AreaKind, string>> = {
  beach: '#f7e3a6', grass: '#cfe3a6', park: '#a6d38a', forest: '#86c177', pitch: '#b9df9a', school: '#f6cf94',
  cemetery: '#c3d9a8', plaza: '#ead7b4', parking: '#e1d8c6', farmland: '#dfe6b4', water: COLORS.sea,
};
const AREA_ORDER: AreaKind[] = ['farmland', 'parking', 'plaza', 'cemetery', 'grass', 'beach', 'school', 'pitch', 'park', 'forest', 'water'];

const BUILDING_COLORS: Record<BuildingKind, string> = {
  residential: '#d9bd9f', tower: '#b99372', public: '#e3a273', religious: '#dba3b4', industrial: '#c3b4a0', landmark: '#e68a5a', target: '#ff5a3c',
};

interface RoadStyle { fill: string; casing: string; minPx: number }
const ROAD_STYLES: Partial<Record<RoadKind, RoadStyle>> = {
  residential: { fill: '#fffaf0', casing: '#e3d4b6', minPx: 1.1 },
  tertiary: { fill: '#fffaf0', casing: '#dcc9a4', minPx: 1.4 },
  secondary: { fill: '#fff0c4', casing: '#d9bf84', minPx: 1.8 },
  primary: { fill: '#ffe08a', casing: '#d9a64a', minPx: 2.2 },
  trunk: { fill: '#ffc46a', casing: '#c9843a', minPx: 2.6 },
  motorway: { fill: '#ffae55', casing: '#b96d2c', minPx: 3 },
};
const ROAD_ORDER: RoadKind[] = ['residential', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];

function bounds(data: CityData) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const extend = (ring: Ring) => {
    for (let i = 0; i < ring.length; i += 2) {
      const x = ring[i]!, z = ring[i + 1]!;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  };
  for (const b of data.buildings) b.rings.forEach(extend);
  for (const r of data.roads) extend(r.pts);
  for (const a of data.areas) a.rings.forEach(extend);
  return { minX: minX - PADDING, maxX: maxX + PADDING, minZ: minZ - PADDING, maxZ: maxZ + PADDING };
}

const tracePolyline = (ctx: CanvasRenderingContext2D, pts: Ring) => {
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
};
const traceRing = (ctx: CanvasRenderingContext2D, ring: Ring) => { tracePolyline(ctx, ring); ctx.closePath(); };

const BUILDING_CHUNK = 3000;
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve));

/**
 * Paints the whole city top-down once: sea, coast, areas, rivers, roads, buildings. World meters map to pixels through the ctx transform.
 * Yields between stages so the start screen keeps animating; buildings are filled one by one because a single 48k-polygon path takes seconds to rasterize.
 */
export async function renderCityMap(data: CityData): Promise<CityMap> {
  const box = bounds(data);
  const widthMeters = box.maxX - box.minX;
  const heightMeters = box.maxZ - box.minZ;
  const metersPerPixel = Math.max(widthMeters, heightMeters) / MAX_PIXELS;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(widthMeters / metersPerPixel);
  canvas.height = Math.ceil(heightMeters / metersPerPixel);
  const ctx = canvas.getContext('2d')!;
  const px = 1 / metersPerPixel;
  ctx.setTransform(px, 0, 0, px, -box.minX * px, -box.minZ * px);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.fillStyle = COLORS.land;
  ctx.fillRect(box.minX, box.minZ, widthMeters, heightMeters);

  ctx.fillStyle = COLORS.sea;
  ctx.beginPath(); traceRing(ctx, data.sea); ctx.fill();

  for (const kind of AREA_ORDER) {
    ctx.fillStyle = AREA_COLORS[kind]!;
    ctx.beginPath();
    for (const area of data.areas) if (area.kind === kind) area.rings.forEach((ring) => traceRing(ctx, ring));
    ctx.fill();
  }

  ctx.strokeStyle = COLORS.sea;
  for (const major of [false, true]) {
    ctx.lineWidth = (major ? 4 : 2) * metersPerPixel * 1.5;
    ctx.beginPath();
    for (const river of data.rivers) if (river.major === major) tracePolyline(ctx, river.pts);
    ctx.stroke();
  }

  ctx.strokeStyle = COLORS.surf; ctx.globalAlpha = 0.9; ctx.lineWidth = 2.2 * metersPerPixel;
  ctx.beginPath(); tracePolyline(ctx, data.coast); ctx.stroke();
  ctx.globalAlpha = 1;

  await nextTask();
  for (const pass of ['casing', 'fill'] as const) {
    for (const kind of ROAD_ORDER) {
      const style = ROAD_STYLES[kind]!;
      ctx.strokeStyle = style[pass];
      const roads = data.roads.filter((r) => r.kind === kind);
      const widthFor = (meters: number) => Math.max(meters, style.minPx * metersPerPixel) + (pass === 'casing' ? 1.2 * metersPerPixel : 0);
      const widths = [...new Set(roads.map((r) => Math.round(r.width)))];
      for (const w of widths) {
        ctx.lineWidth = widthFor(w);
        ctx.beginPath();
        for (const road of roads) if (Math.round(road.width) === w) tracePolyline(ctx, road.pts);
        ctx.stroke();
      }
    }
  }

  await nextTask();
  const buildings = [...data.buildings].sort((a, b) => a.kind.localeCompare(b.kind));
  ctx.strokeStyle = 'rgba(120, 78, 48, .35)';
  ctx.lineWidth = 0.5 * metersPerPixel;
  for (let i = 0; i < buildings.length; i++) {
    if (i % BUILDING_CHUNK === 0 && i > 0) await nextTask();
    const building = buildings[i]!;
    ctx.fillStyle = BUILDING_COLORS[building.kind];
    ctx.beginPath();
    building.rings.forEach((ring) => traceRing(ctx, ring));
    ctx.fill();
    ctx.stroke();
  }

  return { canvas, minX: box.minX, minZ: box.minZ, metersPerPixel, widthMeters, heightMeters };
}
