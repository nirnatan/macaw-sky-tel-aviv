import * as THREE from 'three';
import type { TimeOfDay } from '../contracts';

// One row per time of day. Everything that differs between times lives here; nothing outside this
// table branches on the time name. The sunset row is the original golden-hour look, unchanged.

export interface Row {
  sunAz: number; // compass bearing in degrees, clockwise from north (-z)
  sunEl: number; // degrees above the horizon
  moonAz: number;
  moonEl: number;
  keyFromMoon: number; // 0: the sun is the key light, 1: the moon
  sunLight: THREE.Color; // key light color
  keyIntensity: number;
  sunDisk: THREE.Color;
  skyZenith: THREE.Color;
  skyMidAway: THREE.Color;
  skyMidSun: THREE.Color;
  skyHorizonAway: THREE.Color;
  skyHorizonSun: THREE.Color;
  skyGlow: THREE.Color;
  hazeAway: THREE.Color;
  hazeSun: THREE.Color;
  hazeGlow: THREE.Color;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  ground: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fogDensity: number;
  envIntensity: number;
  exposure: number;
  gradeShadow: THREE.Color;
  gradeHighlight: THREE.Color;
  aoColor: THREE.Color;
  seaDeep: THREE.Color;
  seaShallow: THREE.Color;
  seaAmbient: THREE.Color;
  night: number;
  morning: number;
  stars: number;
  sunUp: number;
}

const srgb = (hex: string, scale = 1) => new THREE.Color(hex).multiplyScalar(scale);
const rgb = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

export const PRESETS: Record<TimeOfDay, Row> = {
  sunrise: {
    sunAz: 100, sunEl: 6, moonAz: 135, moonEl: 35, keyFromMoon: 0,
    sunLight: srgb('#ffb070'), keyIntensity: 3.6,
    sunDisk: srgb('#ffd090', 20),
    skyZenith: srgb('#4a78b8'),
    skyMidAway: srgb('#b9c3e0'),
    skyMidSun: srgb('#f6cf96', 0.85),
    skyHorizonAway: srgb('#e8b4c0'),
    skyHorizonSun: srgb('#ffb068', 1.15),
    skyGlow: srgb('#ffa860', 0.9),
    hazeAway: srgb('#c0b0bc', 0.75),
    hazeSun: srgb('#ffb678', 0.85),
    hazeGlow: srgb('#ffb060', 1.2),
    cloudLit: srgb('#ffd2b0', 1.25),
    cloudShade: srgb('#9080a0', 0.9),
    ground: srgb('#4a3a30', 0.6),
    hemiSky: srgb('#8faee0'), hemiGround: srgb('#5a4a3c'), hemiIntensity: 0.3,
    fogDensity: 0.00045, envIntensity: 0.35, exposure: 1,
    gradeShadow: rgb(0.96, 0.96, 1.06), gradeHighlight: rgb(1.06, 1.0, 0.94), aoColor: srgb('#1a0d10'),
    seaDeep: rgb(0.004, 0.02, 0.045), seaShallow: rgb(0.02, 0.11, 0.11), seaAmbient: rgb(0.5, 0.45, 0.52),
    night: 0.05, morning: 1, stars: 0, sunUp: 1,
  },
  noon: {
    sunAz: 180, sunEl: 58, moonAz: 135, moonEl: 35, keyFromMoon: 0, // never above 60: atmoSunSide and the shadow box assume a slanted sun
    sunLight: srgb('#fff4e6'), keyIntensity: 3.4,
    sunDisk: srgb('#ffffff', 24),
    skyZenith: srgb('#2f6fd0'),
    skyMidAway: srgb('#6fa3e6'),
    skyMidSun: srgb('#86b4ee'),
    skyHorizonAway: srgb('#c6dcf2'),
    skyHorizonSun: srgb('#d4e4f4'),
    skyGlow: srgb('#ffffff', 0.35),
    hazeAway: srgb('#c8d6e6', 0.85),
    hazeSun: srgb('#d6e2ee', 0.9),
    hazeGlow: srgb('#ffffff', 0.5),
    cloudLit: srgb('#ffffff', 1.2),
    cloudShade: srgb('#9fb0c8', 0.95),
    ground: srgb('#50483c', 0.7),
    hemiSky: srgb('#9fc4ff'), hemiGround: srgb('#6a5a48'), hemiIntensity: 0.35,
    fogDensity: 0.00022, envIntensity: 0.4, exposure: 0.95,
    gradeShadow: rgb(0.98, 0.99, 1.03), gradeHighlight: rgb(1.02, 1.0, 0.97), aoColor: srgb('#101418'),
    seaDeep: rgb(0.004, 0.03, 0.07), seaShallow: rgb(0.03, 0.17, 0.17), seaAmbient: rgb(0.5, 0.55, 0.62),
    night: 0, morning: 0, stars: 0, sunUp: 1,
  },
  sunset: {
    sunAz: 255, sunEl: 8.5, moonAz: 135, moonEl: 35, keyFromMoon: 0,
    sunLight: srgb('#ff8f45'), keyIntensity: 4.2,
    sunDisk: srgb('#ffb060', 22),
    skyZenith: srgb('#35609a'),
    skyMidAway: srgb('#a3b0d0'),
    skyMidSun: srgb('#f3bb72', 0.8),
    skyHorizonAway: srgb('#dea39c'),
    skyHorizonSun: srgb('#ff8f3d', 1.2),
    skyGlow: srgb('#ff8a35', 1.0),
    hazeAway: srgb('#ab99a4', 0.72),
    hazeSun: srgb('#ff9a52', 0.85),
    hazeGlow: srgb('#ff9c42', 1.4),
    cloudLit: srgb('#ffb48c', 1.25),
    cloudShade: srgb('#7c6a83', 0.9),
    ground: srgb('#4a3a30', 0.6),
    hemiSky: srgb('#7f9bd0'), hemiGround: srgb('#5a4032'), hemiIntensity: 0.25,
    fogDensity: 0.0004, envIntensity: 0.35, exposure: 1,
    gradeShadow: rgb(0.95, 0.97, 1.06), gradeHighlight: rgb(1.05, 1.0, 0.9), aoColor: srgb('#1a0d08'),
    seaDeep: rgb(0.003, 0.018, 0.042), seaShallow: rgb(0.016, 0.11, 0.105), seaAmbient: rgb(0.45, 0.42, 0.5),
    night: 0.15, morning: 0, stars: 0, sunUp: 1,
  },
  night: {
    sunAz: 255, sunEl: -8, moonAz: 135, moonEl: 35, keyFromMoon: 1,
    sunLight: srgb('#bcd0ff'), keyIntensity: 0.85,
    sunDisk: srgb('#ffb060', 22),
    skyZenith: srgb('#0a1538'),
    skyMidAway: srgb('#15264f'),
    skyMidSun: srgb('#1a2d58'),
    skyHorizonAway: srgb('#2a3f6c'),
    skyHorizonSun: srgb('#34476e'),
    skyGlow: srgb('#3a4a80', 0.25),
    hazeAway: srgb('#1e2c4c', 0.8),
    hazeSun: srgb('#243356', 0.8),
    hazeGlow: srgb('#2a3a60', 0.4),
    cloudLit: srgb('#5a6a9a', 0.9),
    cloudShade: srgb('#1c2440', 0.9),
    ground: srgb('#1a1c28', 0.6),
    hemiSky: srgb('#4a62a8'), hemiGround: srgb('#201c30'), hemiIntensity: 0.7,
    fogDensity: 0.00035, envIntensity: 0.35, exposure: 1.4,
    gradeShadow: rgb(0.92, 0.96, 1.14), gradeHighlight: rgb(1.0, 1.0, 1.04), aoColor: srgb('#05060e'),
    seaDeep: rgb(0.002, 0.006, 0.02), seaShallow: rgb(0.006, 0.02, 0.035), seaAmbient: rgb(0.25, 0.3, 0.45),
    night: 1, morning: 0, stars: 1, sunUp: 0,
  },
};

const AZIMUTH_KEYS = new Set<keyof Row>(['sunAz', 'moonAz']);

export function cloneRow(row: Row): Row {
  const out = { ...row };
  for (const key of Object.keys(row) as (keyof Row)[]) {
    const v = row[key];
    if (v instanceof THREE.Color) (out as Record<keyof Row, unknown>)[key] = v.clone();
  }
  return out;
}

export function copyRow(out: Row, from: Row) {
  for (const key of Object.keys(from) as (keyof Row)[]) {
    const v = from[key];
    if (v instanceof THREE.Color) (out[key] as THREE.Color).copy(v);
    else (out as Record<keyof Row, unknown>)[key] = v;
  }
}

const shortestArc = (a: number, b: number) => ((b - a + 540) % 360) - 180;

/** out = a + (b - a) * t, with colors linear and azimuths along the shortest arc. */
export function blendRow(out: Row, a: Row, b: Row, t: number) {
  for (const key of Object.keys(a) as (keyof Row)[]) {
    const va = a[key], vb = b[key];
    if (va instanceof THREE.Color) (out[key] as THREE.Color).lerpColors(va, vb as THREE.Color, t);
    else if (AZIMUTH_KEYS.has(key)) (out as Record<keyof Row, unknown>)[key] = (va + shortestArc(va, vb as number) * t + 360) % 360;
    else (out as Record<keyof Row, unknown>)[key] = va + ((vb as number) - va) * t;
  }
}

export function directionFrom(azDeg: number, elDeg: number, out: THREE.Vector3) {
  const az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg);
  return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
}
