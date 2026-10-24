import * as THREE from 'three';
import type { Conditions, TimeOfDay } from '../contracts';
import { blendRow, cloneRow, copyRow, directionFrom, PRESETS } from './presets';

// Pure blend state: no renderer, no three objects beyond math. index.ts applies the result every frame.

export const TIME_BLEND_SECONDS = 4;
const RAIN_IN = 5, RAIN_OUT = 3, OVERCAST_TAU = 3, WET_IN = 8, WET_OUT = 20;
const RAINBOW_RISE = 3, RAINBOW_HOLD = 40, RAINBOW_FADE = 10, RAINBOW_CANCEL = 2;
const MIN_KEY_ELEVATION = Math.sin(THREE.MathUtils.degToRad(3)); // shadows never come from below the horizon
const OVERCAST_GRAY = new THREE.Color(0.5, 0.55, 0.63);
const OVERCAST_GRAY_LUMINANCE = luminance(OVERCAST_GRAY);
const SKY_BASE_KEYS = ['skyZenith', 'skyMidAway', 'skyMidSun', 'skyHorizonAway', 'skyHorizonSun', 'hazeAway', 'hazeSun', 'cloudLit', 'cloudShade'] as const;
const GLOW_KEYS = ['skyGlow', 'hazeGlow'] as const;

function luminance(c: THREE.Color) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }
const smoothstep = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const approach = (v: number, target: number, maxStep: number) => v + THREE.MathUtils.clamp(target - v, -maxStep, maxStep);

export interface StepInfo {
  blending: boolean; // a time blend advanced this frame
  blendEnded: boolean;
}

export function createWeather(initial: Conditions) {
  let targetTime: TimeOfDay = initial.time;
  let targetRain = initial.rain;
  const from = cloneRow(PRESETS[targetTime]);
  const to = cloneRow(PRESETS[targetTime]);
  const blended = cloneRow(PRESETS[targetTime]);
  const row = cloneRow(PRESETS[targetTime]); // blended row with the overcast modifiers applied
  let blendT = 1;

  let rain = initial.rain ? 1 : 0, overcast = rain, wetness = rain;
  let rainbowPhase: 'idle' | 'armed' | 'shining' = 'idle';
  let shineTime = 0, rainbowLevel = 0;

  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), keyDir = new THREE.Vector3();
  const grayTarget = new THREE.Color(), keyGray = new THREE.Color();
  const state = { row, sunDir, moonDir, keyDir, keyIntensity: 0, shadowFade: 1, rain, overcast, wetness, rainbow: 0 };

  // The sun's side of the sky (glow, disk, warm horizon) goes in the first half of a dusk blend and comes back in the
  // second half of a dawn one, so the hidden sun can be moved to the next day's azimuth while nothing shows where it is.
  function deriveRow(sunSide: number) {
    copyRow(row, blended);
    row.skyMidSun.lerp(row.skyMidAway, 1 - sunSide);
    row.skyHorizonSun.lerp(row.skyHorizonAway, 1 - sunSide);
    row.hazeSun.lerp(row.hazeAway, 1 - sunSide);
    row.skyGlow.multiplyScalar(sunSide);
    row.hazeGlow.multiplyScalar(sunSide);
    row.sunDisk.multiplyScalar(sunSide);
    const gray = THREE.MathUtils.clamp(luminance(blended.skyMidAway) / OVERCAST_GRAY_LUMINANCE, 0.03, 1.3);
    grayTarget.copy(OVERCAST_GRAY).multiplyScalar(gray);
    for (const k of SKY_BASE_KEYS) row[k].lerp(grayTarget, 0.6 * overcast);
    for (const k of GLOW_KEYS) row[k].multiplyScalar(1 - 0.7 * overcast);
    keyGray.copy(grayTarget).multiplyScalar(luminance(blended.sunLight) / Math.max(luminance(grayTarget), 1e-3));
    row.sunLight.lerp(keyGray, 0.6 * overcast); // cloud-filtered key loses its color, not its brightness
    row.fogDensity *= 1 + 0.6 * overcast;
    row.hemiIntensity *= 1 + 0.3 * overcast;
    row.exposure += 0.1 * overcast;
  }

  function applyKey() {
    directionFrom(blended.sunAz, blended.sunEl, sunDir);
    directionFrom(blended.moonAz, blended.moonEl, moonDir);
    const w = blended.keyFromMoon;
    keyDir.copy(w < 0.5 ? sunDir : moonDir);
    if (keyDir.y < MIN_KEY_ELEVATION) { keyDir.y = MIN_KEY_ELEVATION; keyDir.normalize(); }
    const envelope = Math.abs(1 - 2 * w); // dims to zero where the direction swaps
    state.keyIntensity = blended.keyIntensity * envelope * (1 - 0.65 * overcast);
    state.shadowFade = blended.shadowIntensity * envelope * (1 - 0.8 * overcast);
  }

  function step(dt: number): StepInfo {
    const wasBlending = blendT < 1;
    if (wasBlending) {
      blendT = Math.min(1, blendT + dt / TIME_BLEND_SECONDS);
      blendRow(blended, from, to, smoothstep(0, 1, blendT));
    }

    rain = approach(rain, targetRain ? 1 : 0, targetRain ? dt / RAIN_IN : dt / RAIN_OUT);
    overcast += (rain - overcast) * (1 - Math.exp(-dt / OVERCAST_TAU));
    wetness = approach(wetness, rain, rain > wetness ? dt / WET_IN : dt / WET_OUT);

    if (rainbowPhase === 'armed' && overcast < 0.4) { rainbowPhase = 'shining'; shineTime = 0; }
    if (rainbowPhase === 'shining') {
      shineTime += dt;
      rainbowLevel = smoothstep(0, RAINBOW_RISE, shineTime) * (1 - smoothstep(RAINBOW_RISE + RAINBOW_HOLD, RAINBOW_RISE + RAINBOW_HOLD + RAINBOW_FADE, shineTime));
      if (shineTime > RAINBOW_RISE + RAINBOW_HOLD + RAINBOW_FADE) rainbowPhase = 'idle';
    } else {
      rainbowLevel = approach(rainbowLevel, 0, dt / RAINBOW_CANCEL);
    }

    const sunSide = smoothstep(0.5, 1, blended.sunUp);
    deriveRow(sunSide);
    applyKey();
    state.rain = rain; state.overcast = overcast; state.wetness = wetness;
    state.rainbow = rainbowLevel * sunSide;
    return { blending: wasBlending, blendEnded: wasBlending && blendT >= 1 };
  }

  return {
    state,
    get target(): Conditions { return { time: targetTime, rain: targetRain }; },
    setConditions(c: Conditions, instant: boolean) {
      if (c.time !== targetTime) {
        targetTime = c.time;
        copyRow(from, blended); // re-targets from the current look, no jump
        copyRow(to, PRESETS[targetTime]);
        blendT = 0;
        // The sun sets where it is and rises where the day wants it, instead of sweeping along the horizon.
        // Both moves happen while sunSide is 0 (see deriveRow), so neither shows.
        if (to.sunUp < 0.5) to.sunAz = from.sunAz;
        else if (from.sunUp < 0.5) from.sunAz = to.sunAz;
      }
      if (c.rain !== targetRain) {
        targetRain = c.rain;
        if (targetRain) rainbowPhase = 'idle';
        else if (blended.sunUp > 0.5) rainbowPhase = 'armed';
      }
      if (instant) { // the steady state of the target, whatever was in flight
        copyRow(blended, PRESETS[targetTime]);
        blendT = 1;
        rain = overcast = wetness = targetRain ? 1 : 0;
        rainbowPhase = 'idle';
        rainbowLevel = 0;
        step(0);
      }
    },
    step,
  };
}
