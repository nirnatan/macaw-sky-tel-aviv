import type { Analog, InputHooks } from './hooks';
import { clamp } from './hooks';

const AXES = {
  steer: { negative: ['ArrowLeft', 'KeyA'], positive: ['ArrowRight', 'KeyD'] },
  climb: { negative: ['ArrowDown', 'KeyS'], positive: ['ArrowUp', 'KeyW'] }, // up = nose up
} as const;
const HOLD = { flap: ['Space'], boost: ['ShiftLeft', 'ShiftRight'] } as const;
const PRESS = { KeyL: 'landToggle', KeyX: 'squawk', Escape: 'pause', KeyP: 'pause' } as const;
const ROLL = { KeyQ: -1, KeyE: 1 } as const;

const GAME_KEYS = new Set<string>([
  ...AXES.steer.negative, ...AXES.steer.positive, ...AXES.climb.negative, ...AXES.climb.positive,
  ...HOLD.flap, ...HOLD.boost, ...Object.keys(PRESS), ...Object.keys(ROLL),
]);

const RISE_RATE = 9; // 1/s, how fast a held key ramps the axis toward +-1
const FALL_RATE = 15; // 1/s, how fast a released key returns the axis to 0

const approach = (value: number, target: number, rate: number, dt: number) => {
  const next = value + (target - value) * (1 - Math.exp(-rate * dt));
  return Math.abs(next) < 0.002 ? 0 : next;
};

export function createKeyboard(hooks: InputHooks) {
  const held = new Set<string>();
  const heldAny = (codes: readonly string[]) => codes.some((c) => held.has(c));
  const axis = (a: { negative: readonly string[]; positive: readonly string[] }) => (heldAny(a.positive) ? 1 : 0) - (heldAny(a.negative) ? 1 : 0);
  let steer = 0;
  let climb = 0;

  const isTyping = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

  const onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || !GAME_KEYS.has(e.code)) return;
    e.preventDefault();
    hooks.device('keyboard');
    held.add(e.code);
    if (e.repeat) return;
    if (e.code in PRESS) hooks.press(PRESS[e.code as keyof typeof PRESS]);
    if (e.code in ROLL) hooks.roll(ROLL[e.code as keyof typeof ROLL]);
  };
  const onKeyUp = (e: KeyboardEvent) => { held.delete(e.code); };
  const releaseAll = () => { held.clear(); };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', releaseAll);

  return {
    read(dt: number): Analog {
      const steerTarget = axis(AXES.steer);
      const climbTarget = axis(AXES.climb);
      steer = approach(steer, steerTarget, steerTarget === 0 ? FALL_RATE : RISE_RATE, dt);
      climb = approach(climb, climbTarget, climbTarget === 0 ? FALL_RATE : RISE_RATE, dt);
      return { steer: clamp(steer, -1, 1), climb: clamp(climb, -1, 1), flap: heldAny(HOLD.flap), boost: heldAny(HOLD.boost) };
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', releaseAll);
    },
  };
}
