import * as THREE from 'three';
import type { Lighting } from '../../contracts';

/** The few scalars every landmark part reads from the lighting. All are 0 on a dry day, so day looks never change. */
export interface Mood {
  /** Night glow: 0 at sunset and in daylight, 1 deep in the night. */
  glow: number;
  /** Gray weather: the larger of overcast and rain. */
  gray: number;
  wet: number;
  rain: number;
  /** How much sun shines through fabric: 1 on a clear day, 0 at night, lower under clouds. */
  daylight: number;
}

export const moodOf = (l: Lighting, out: Mood): Mood => {
  out.glow = THREE.MathUtils.smoothstep(l.night, 0.15, 0.85);
  out.gray = Math.max(l.overcast, l.rain);
  out.wet = l.wetness;
  out.rain = l.rain;
  out.daylight = (1 - out.glow) * (1 - 0.6 * out.gray);
  return out;
};

/** Visibility test for night-only objects; a pure function of the mood so an all-on warm-up compiles them. */
export const lit = (m: Mood) => m.glow > 0.001;

/** Linear-light luminance, used to make differently colored glows equally bright. */
export const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
