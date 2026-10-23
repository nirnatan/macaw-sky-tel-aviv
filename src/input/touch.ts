import type { Analog, InputHooks } from './hooks';
import { clamp } from './hooks';
import './touch.css';

const ICONS = {
  flap: '<svg viewBox="0 0 24 24"><path d="M2 14c4 0 7-2.500 10-8 3 5.500 6 8 10 8-4 2-7 1-10-2-3 3-6 4-10 2z"/></svg>',
  boost: '<svg viewBox="0 0 24 24"><path d="M13 2 5 13.500h6L10 22l9-12h-6z"/></svg>',
  land: '<svg viewBox="0 0 24 24"><path d="M12 3v11M7 10l5 5 5-5M5 20h14"/></svg>',
  squawk: '<svg viewBox="0 0 24 24"><circle cx="9" cy="12" r="6"/><path d="M14 9.500c5-1.500 8 1.500 7 6-1.500-2-4-3-6.500-2.500M9 9.500h.01" /><path d="M19 4c1.500 1 2 2.500 1.500 4"/></svg>',
} as const;

const BUTTONS = [
  { id: 'squawk', label: 'קריאה', hold: false },
  { id: 'land', label: 'נחיתה', hold: false },
  { id: 'boost', label: 'טורבו', hold: true },
  { id: 'flap', label: 'כנפיים', hold: true },
] as const;

const DEADZONE = 0.12;
const stopDefault = (e: Event) => e.preventDefault();

export function createTouchControls(root: HTMLElement, hooks: InputHooks) {
  const layer = document.createElement('div');
  layer.className = 'mc-touch';
  layer.hidden = true;
  layer.innerHTML = `
    <div class="mc-stick-zone"><div class="mc-stick"><div class="mc-knob"></div></div></div>
    <div class="mc-btns">${BUTTONS.map((b) => `<div class="mc-btn mc-btn-${b.id}" data-id="${b.id}" role="button" aria-label="${b.id}">${ICONS[b.id]}${b.id === 'squawk' ? '' : `<span>${b.label}</span>`}</div>`).join('')}</div>`;
  root.append(layer);

  const zone = layer.querySelector<HTMLElement>('.mc-stick-zone')!;
  const stick = layer.querySelector<HTMLElement>('.mc-stick')!;
  const knob = layer.querySelector<HTMLElement>('.mc-knob')!;

  let wanted = false;
  let touchSeen = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
  const refresh = () => { layer.hidden = !(wanted && touchSeen); };

  const holds: Record<string, boolean> = { flap: false, boost: false };
  const joystick = { x: 0, y: 0, pointerId: -1, originX: 0, originY: 0, radius: 1 };

  const placeStick = (x: number, y: number) => { stick.style.left = `${x}px`; stick.style.top = `${y}px`; };
  const resetStick = () => {
    joystick.pointerId = -1; joystick.x = 0; joystick.y = 0;
    stick.classList.remove('active');
    knob.style.transform = '';
    stick.style.left = 'calc(var(--u) * 1.9 + 8px)';
    stick.style.top = 'calc(100% - var(--u) * 1.9 - 8px)';
  };
  resetStick();

  zone.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || joystick.pointerId !== -1) return;
    stopDefault(e);
    const rect = zone.getBoundingClientRect();
    joystick.radius = stick.offsetWidth / 2;
    const margin = joystick.radius + 6;
    joystick.originX = clamp(e.clientX - rect.left, margin, rect.width - margin);
    joystick.originY = clamp(e.clientY - rect.top, margin, rect.height - margin);
    joystick.pointerId = e.pointerId;
    placeStick(joystick.originX, joystick.originY);
    stick.classList.add('active');
    zone.setPointerCapture(e.pointerId);
    moveStick(e);
  });
  const moveStick = (e: PointerEvent) => {
    if (e.pointerId !== joystick.pointerId) return;
    const rect = zone.getBoundingClientRect();
    const dx = e.clientX - rect.left - joystick.originX;
    const dy = e.clientY - rect.top - joystick.originY;
    const reach = joystick.radius * 0.75;
    const length = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, length / reach);
    knob.style.transform = `translate(${(dx / length) * k * reach}px, ${(dy / length) * k * reach}px)`;
    const mag = k < DEADZONE ? 0 : (k - DEADZONE) / (1 - DEADZONE);
    joystick.x = (dx / length) * mag;
    joystick.y = -(dy / length) * mag; // screen up = climb
  };
  const endStick = (e: PointerEvent) => { if (e.pointerId === joystick.pointerId) resetStick(); };
  zone.addEventListener('pointermove', moveStick);
  zone.addEventListener('pointerup', endStick);
  zone.addEventListener('pointercancel', endStick);

  for (const b of BUTTONS) {
    const button = layer.querySelector<HTMLElement>(`.mc-btn-${b.id}`)!;
    const release = () => { button.classList.remove('down'); if (b.hold) holds[b.id] = false; };
    button.addEventListener('pointerdown', (e) => {
      stopDefault(e);
      button.setPointerCapture(e.pointerId);
      button.classList.add('down');
      if (b.hold) holds[b.id] = true;
      else hooks.press(b.id === 'land' ? 'landToggle' : 'squawk');
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  }

  layer.addEventListener('contextmenu', stopDefault);
  root.addEventListener('touchmove', stopDefault, { passive: false });
  const blockPinch = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', blockPinch);
  document.addEventListener('gesturechange', blockPinch);
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    hooks.device('touch');
    if (!touchSeen) { touchSeen = true; refresh(); }
  }, true);

  return {
    setVisible(v: boolean) { wanted = v; refresh(); },
    read(): Analog {
      return { steer: joystick.x, climb: joystick.y, flap: holds.flap, boost: holds.boost };
    },
  };
}
