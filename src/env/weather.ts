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
  const blended = cloneRow(PRESETS[targetTime]);
  const row = cloneRow(PRESETS[targetTime]); // blended row with the overcast modifiers applied
  let blendT = 1;

  let rain = initial.rain ? 1 : 0, overcast = rain, wetness = rain;
  let rainbowPhase: 'idle' | 'armed' | 'shining' = 'idle';
  let shineTime = 0, rainbowLevel = 0;

  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), keyDir = new THREE.Vector3();
  const grayTarget = new THREE.Color(), keyGray = new THREE.Color();
  const state = { row, sunDir, moonDir, keyDir, keyIntensity: 0, shadowFade: 1, rain, overcast, wetness, rainbow: 0 };

  function applyOvercast() {
    copyRow(row, blended);
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
    state.shadowFade = envelope * (1 - 0.8 * overcast);
  }

  function step(dt: number): StepInfo {
    const wasBlending = blendT < 1;
    if (wasBlending) {
      blendT = Math.min(1, blendT + dt / TIME_BLEND_SECONDS);
      blendRow(blended, from, PRESETS[targetTime], smoothstep(0, 1, blendT));
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

    applyOvercast();
    applyKey();
    state.rain = rain; state.overcast = overcast; state.wetness = wetness;
    state.rainbow = rainbowLevel * blended.sunUp;
    return { blending: wasBlending, blendEnded: wasBlending && blendT >= 1 };
  }

  return {
    state,
    get target(): Conditions { return { time: targetTime, rain: targetRain }; },
    setConditions(c: Conditions, instant: boolean) {
      if (c.time !== targetTime) {
        targetTime = c.time;
        if (instant) { copyRow(blended, PRESETS[targetTime]); blendT = 1; }
        else { copyRow(from, blended); blendT = 0; } // re-targets from the current look, no jump
      }
      if (c.rain !== targetRain) {
        targetRain = c.rain;
        if (targetRain) rainbowPhase = 'idle';
        else if (blended.sunUp > 0.5) rainbowPhase = 'armed';
        if (instant) { rain = overcast = wetness = targetRain ? 1 : 0; rainbowPhase = 'idle'; rainbowLevel = 0; }
      }
      if (instant) step(0);
    },
    step,
  };
}
