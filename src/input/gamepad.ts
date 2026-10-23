import type { Analog, InputHooks } from './hooks';
import { clamp } from './hooks';

const BUTTON = { a: 0, b: 1, y: 3, lb: 4, rb: 5, rt: 7, start: 9 } as const;
const DEADZONE = 0.18;
const ACTIVITY = 0.4; // stick/trigger level that counts as "the kid is using the pad"

const withDeadzone = (x: number, y: number): [number, number] => {
  const magnitude = Math.hypot(x, y);
  if (magnitude < DEADZONE) return [0, 0];
  const scale = Math.min(1, (magnitude - DEADZONE) / (1 - DEADZONE)) / magnitude;
  return [x * scale, y * scale];
};

export function createGamepad(hooks: InputHooks) {
  let previous: boolean[] = [];

  return {
    poll(): Analog {
      const pad = navigator.getGamepads?.().find((p): p is Gamepad => p !== null && p.connected);
      if (!pad) { previous = []; return { steer: 0, climb: 0, flap: false, boost: false }; }

      const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.5);
      const edge = (index: number) => pressed[index] && !previous[index];
      if (edge(BUTTON.b)) hooks.press('landToggle');
      if (edge(BUTTON.y)) hooks.press('squawk');
      if (edge(BUTTON.start)) hooks.press('pause');
      if (edge(BUTTON.lb)) hooks.roll(-1);
      if (edge(BUTTON.rb)) hooks.roll(1);

      const [steer, climb] = withDeadzone(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0)); // stick up = climb
      const flap = pressed[BUTTON.a] === true;
      const boost = (pad.buttons[BUTTON.rt]?.value ?? 0) > 0.4 || pressed[BUTTON.rt] === true;

      const active = Math.hypot(steer, climb) > ACTIVITY || pressed.some((p, i) => p && !previous[i]) || boost;
      if (active) hooks.device('gamepad');
      previous = pressed;
      return { steer: clamp(steer, -1, 1), climb: clamp(climb, -1, 1), flap, boost };
    },
  };
}
