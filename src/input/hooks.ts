import type { InputState } from '../contracts';

export type Device = InputState['device'];

/** How a source reports into the shared InputState. */
export interface InputHooks {
  press(key: 'landToggle' | 'squawk' | 'pause' | 'cycleTime' | 'toggleRain'): void;
  roll(direction: -1 | 1): void;
  device(device: Device): void;
}

/** Continuous values a source contributes each frame. */
export interface Analog {
  steer: number;
  climb: number;
  flap: boolean;
  boost: boolean;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
