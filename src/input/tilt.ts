import type { Analog } from './hooks';
import { clamp } from './hooks';

/** Degrees away from the calibrated hold: no response inside `deadzone`, full deflection at `full`. */
interface AxisShape { deadzone: number; full: number }
const STEER: AxisShape = { deadzone: 4, full: 26 };
const CLIMB: AxisShape = { deadzone: 7, full: 30 };
const SMOOTHING_SECONDS = 0.12;
const ROTATION_SETTLE_MS = 700; // the hand is still moving right after the screen rotates

/** The hold in the screen's own frame, in degrees. side: right edge down is positive. pitch: 90 upright, 0 flat face up. */
export interface Hold { side: number; pitch: number }

const RAD = Math.PI / 180;

/** Screen rotation from the device's natural portrait, in degrees counter-clockwise (iOS window.orientation convention). */
const screenAngle = () => screen.orientation?.angle ?? Number((window as { orientation?: number }).orientation ?? 0);

/**
 * Gravity from the W3C Z-X'-Y'' Euler angles, in device coordinates (x right, y up, z out of the screen),
 * turned into the current screen orientation. Alpha (compass) never matters, so a drifting compass cannot steer.
 * Kids steer two ways: tipping an edge down (reads best as lean, around the screen's long axis) and turning the phone
 * like a wheel (reads best as roll, around the screen normal). The flatter the hold, the more lean counts.
 */
export function holdFrom(beta: number, gamma: number, angle: number): Hold {
  const b = beta * RAD, g = gamma * RAD, a = angle * RAD;
  const dx = Math.sin(g) * Math.cos(b), dy = -Math.sin(b), dz = -Math.cos(g) * Math.cos(b);
  const sx = dx * Math.cos(a) - dy * Math.sin(a);
  const sy = dx * Math.sin(a) + dy * Math.cos(a);
  const lean = Math.atan2(sx, -dz), roll = Math.atan2(sx, -sy);
  const flat = dz * dz, upright = sy * sy;
  return { side: (flat * lean + upright * roll) / ((flat + upright) || 1) / RAD, pitch: Math.atan2(-sy, -dz) / RAD };
}

const wrapDegrees = (d: number) => ((d + 540) % 360) - 180;

/** Deadzone, then a curve that is gentle near center so small wobbles barely steer. */
export function shape(degrees: number, { deadzone, full }: AxisShape): number {
  const t = clamp((Math.abs(degrees) - deadzone) / (full - deadzone), 0, 1);
  return Math.sign(degrees) * (0.35 * t + 0.65 * t * t);
}

export function createTilt() {
  const supported = typeof DeviceOrientationEvent !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  let active = false;
  let latest: Hold | null = null;
  let neutral: Hold | null = null;
  let settleUntil = 0;
  let steer = 0;
  let climb = 0;

  const onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    latest = holdFrom(e.beta, e.gamma, screenAngle());
    if (!neutral && performance.now() >= settleUntil) neutral = latest;
  };
  const recalibrate = () => { neutral = latest; };
  const onRotate = () => { neutral = null; settleUntil = performance.now() + ROTATION_SETTLE_MS; };

  const start = () => {
    if (active) return;
    active = true;
    neutral = null;
    settleUntil = 0;
    window.addEventListener('deviceorientation', onOrientation);
    screen.orientation?.addEventListener('change', onRotate);
    window.addEventListener('orientationchange', onRotate);
  };
  const stop = () => {
    active = false;
    latest = neutral = null;
    steer = climb = 0;
    window.removeEventListener('deviceorientation', onOrientation);
    screen.orientation?.removeEventListener('change', onRotate);
    window.removeEventListener('orientationchange', onRotate);
  };

  return {
    supported,
    /** Call straight from a tap: iOS only shows its motion prompt during a user gesture. */
    async enable(on: boolean): Promise<boolean> {
      if (!on || !supported) { stop(); return false; }
      if (active) { recalibrate(); return true; }
      const request = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<PermissionState> }).requestPermission;
      if (request) {
        try {
          if (await request.call(DeviceOrientationEvent) !== 'granted') return false;
        } catch {
          return false; // not inside a gesture, or the page is not a secure context
        }
      }
      start();
      return true;
    },
    recalibrate,
    read(dt: number): Analog {
      let targetSteer = 0, targetClimb = 0;
      if (active && latest && neutral) {
        targetSteer = shape(latest.side - neutral.side, STEER);
        targetClimb = shape(wrapDegrees(latest.pitch - neutral.pitch), CLIMB);
      }
      const k = 1 - Math.exp(-dt / SMOOTHING_SECONDS);
      steer += (targetSteer - steer) * k;
      climb += (targetClimb - climb) * k;
      return { steer, climb, flap: false, boost: false };
    },
  };
}
