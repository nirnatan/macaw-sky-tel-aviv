import type { Input, InputState } from '../contracts';
import type { InputHooks } from './hooks';
import { clamp } from './hooks';
import { createGamepad } from './gamepad';
import { createKeyboard } from './keyboard';
import { createTouchControls } from './touch';

const MAX_FRAME = 0.1; // seconds, so a hidden tab does not jerk the smoothing

export function createInput(root: HTMLElement): Input {
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
  const state: InputState = {
    steer: 0, climb: 0, strafe: 0, flap: false, boost: false,
    landToggle: false, squawk: false, roll: 0, pause: false, cycleTime: false, toggleRain: false,
    device: matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard',
  };
  const hooks: InputHooks = {
    press: (key) => { state[key] = true; },
    roll: (direction) => { state.roll = direction; },
    device: (device) => { state.device = device; },
  };
  const keyboard = createKeyboard(hooks);
  const touch = createTouchControls(root, hooks);
  const gamepad = createGamepad(hooks);
  let lastTime = performance.now();

  return {
    state,
    endFrame() {
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, MAX_FRAME);
      lastTime = now;
      state.landToggle = false;
      state.squawk = false;
      state.pause = false;
      state.cycleTime = false;
      state.toggleRain = false;
      state.roll = 0;
      const sources = [keyboard.read(dt), touch.read(), gamepad.poll()];
      state.steer = clamp(sources.reduce((sum, s) => sum + s.steer, 0), -1, 1);
      state.climb = clamp(sources.reduce((sum, s) => sum + s.climb, 0), -1, 1);
      state.flap = sources.some((s) => s.flap);
      state.boost = sources.some((s) => s.boost);
    },
    setTouchControlsVisible: touch.setVisible,
  };
}
