import type { AudioMix, HudFrame, PlayerName, Species, TargetHud, TimeOfDay } from '../src/contracts';
import { createAudio } from '../src/audio';
import { createInput } from '../src/input';
import { createUI, HINT_KEYS } from '../src/ui';

import { loadCityData } from '../src/world/data';

const params = new URLSearchParams(location.search);
if (params.has('nopanel')) document.body.classList.add('no-panel');

const root = document.getElementById('game')!;
// What env's blended lighting would hand to the audio: night and morning follow the time, rain follows the toggle.
const PRESET: Record<TimeOfDay, { night: number; morning: number }> = {
  sunrise: { night: 0.05, morning: 1 }, noon: { night: 0, morning: 0 }, sunset: { night: 0.15, morning: 0 }, night: { night: 1, morning: 0 },
};
const mix = { night: PRESET.sunset.night, rain: 0, morning: 0 };
let slidersDriven = false;
const standIn = document.getElementById('stand-in-text')!;
const input = createInput(root);
const audio = createAudio();
const data = await loadCityData();
const ui = createUI({ root, data, input });
Object.assign(window, { ui, audio, input });

ui.setLoading(0.6, 'loading city data');
await new Promise((r) => setTimeout(r, params.has('slowload') ? 4000 : 150));
ui.setLoading(1);

const showConditions = (s: { time: TimeOfDay; rain: boolean }) => { root.dataset.time = s.time; root.dataset.rain = String(s.rain); };
showConditions(ui.settings);
Object.assign(mix, PRESET[ui.settings.time], { rain: ui.settings.rain ? 1 : 0 });
audio.setMuted(ui.settings.muted);
audio.setMusic(ui.settings.music);
ui.onSettings((s) => { audio.setMuted(s.muted); audio.setMusic(s.music); showConditions(s); slidersDriven = false; console.log('settings', JSON.stringify(s)); });
ui.onPause((paused) => console.log('paused', paused));

const BIRD_COLORS: Record<Species, string> = { blueGold: '#2b7de9', scarlet: '#e8332a' };
let species: Species = 'blueGold';
let player: PlayerName = 'Amit';
const choice = await ui.showStart((c) => {
  species = c.species; player = c.player;
  standIn.textContent = `3D preview: ${c.species}, ${c.player}`;
  document.getElementById('stand-in')!.style.setProperty('--bird', BIRD_COLORS[c.species]);
});
await audio.unlock();
audio.found();
console.log('play', JSON.stringify(choice));

const found = { school: false, gan: false };
let rings = 3;
let forcedHint: string | null = null;
let hintCycle = true;
ui.showHud(true);
input.setTouchControlsVisible(true);

const centerX = (data.targets.school.x + data.targets.gan.x) / 2;
const centerZ = (data.targets.school.z + data.targets.gan.z) / 2;

const frameAt = (t: number): HudFrame => {
  const phase = (t / 40) % 1; // radius shrinks from far to near every 40 s
  const radius = 1400 * (1 - phase) + 120;
  const angle = t * 0.35;
  const x = centerX + Math.cos(angle) * radius;
  const z = centerZ + Math.sin(angle) * radius;
  const heading = angle + Math.PI; // direction of travel along the circle
  const targets: TargetHud[] = (['school', 'gan'] as const).map((id) => {
    const dx = data.targets[id].x - x, dz = data.targets[id].z - z;
    const absolute = Math.atan2(dx, -dz);
    return { id, found: found[id], bearing: Math.atan2(Math.sin(absolute - heading), Math.cos(absolute - heading)), distance: Math.hypot(dx, dz) };
  });
  return {
    speed: 16 + 8 * Math.sin(t * 0.7), altitude: 120 + 60 * Math.sin(t * 0.3), mode: 'flying', targets, player: { x, z, heading },
    rings: { collected: rings, total: 12 }, hint: forcedHint ?? (hintCycle ? HINT_KEYS[Math.floor(t / 3.5) % HINT_KEYS.length]! : null),
  };
};

const buttons = document.getElementById('buttons')!;
const addButton = (label: string, fn: () => void) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => fn();
  buttons.append(b);
};
addButton('T: next time', () => { input.state.cycleTime = true; });
addButton('R: toggle rain', () => { input.state.toggleRain = true; });
addButton('celebrate school', () => { found.school = true; ui.celebrate('school', player); audio.found(); });
addButton('celebrate gan', () => { found.gan = true; ui.celebrate('gan', player); audio.found(); });
addButton('celebrate all', () => { found.school = found.gan = true; ui.celebrate('all', player); audio.found(); });
addButton('reset found', () => { found.school = found.gan = false; });
addButton('toast', () => ui.toast('טבעת זהב! Golden ring!'));
addButton('ring +1', () => { rings++; audio.ring(); });
for (const [label, fn] of [
  ['flap', () => audio.flap(0.8)], ['squawk blue', () => audio.squawk('blueGold')], ['squawk scarlet', () => audio.squawk('scarlet')],
  ['ring', () => audio.ring()], ['found', () => audio.found()], ['land', () => audio.land()],
] as const) addButton(label, fn);
const hintSelect = document.createElement('select');
hintSelect.innerHTML = ['cycle', 'none', ...HINT_KEYS].map((k) => `<option>${k}</option>`).join('');
hintSelect.onchange = () => { hintCycle = hintSelect.value === 'cycle'; forcedHint = HINT_KEYS.includes(hintSelect.value as never) ? hintSelect.value : null; };
buttons.append(hintSelect);

for (const key of ['night', 'rain', 'morning'] as const) {
  const label = document.createElement('label');
  label.textContent = key;
  const slider = document.createElement('input');
  Object.assign(slider, { type: 'range', min: '0', max: '1', step: '0.01', value: String(mix[key]), id: `mix-${key}` });
  slider.oninput = () => { slidersDriven = true; mix[key] = Number(slider.value); };
  label.append(slider);
  buttons.append(label);
}
const approach = (value: number, target: number, seconds: number, dt: number) => value + (target - value) * (1 - Math.exp(-dt / seconds));
Object.assign(window, { mix });

const readout = document.getElementById('readout')!;
const t0 = performance.now();
let lastFlap = 0;
let lastT = 0;
const loop = () => {
  const t = (performance.now() - t0) / 1000;
  const dt = t - lastT;
  lastT = t;
  if (!slidersDriven) {
    const target = PRESET[ui.settings.time];
    mix.night = approach(mix.night, target.night, 1.5, dt);
    mix.morning = approach(mix.morning, target.morning, 1.5, dt);
    mix.rain = approach(mix.rain, ui.settings.rain ? 1 : 0, 2, dt);
  }
  root.style.setProperty('--rain', mix.rain.toFixed(2));
  const frame = frameAt(t);
  ui.updateHud(frame);
  const s = input.state;
  if (s.flap && t - lastFlap > 0.25) { lastFlap = t; audio.flap(0.7); }
  if (s.squawk) audio.squawk(species);
  if (s.landToggle) audio.land();
  const audioMix: AudioMix = { speed: frame.speed + (s.boost ? 14 : 0), altitude: frame.altitude, distanceToCoast: 200 + 1500 * (0.5 + 0.5 * Math.sin(t * 0.2)), flying: true, effort: s.flap ? 1 : 0.4, ...mix };
  audio.update(audioMix);
  readout.textContent = JSON.stringify({ ...s, steer: +s.steer.toFixed(2), climb: +s.climb.toFixed(2), ...ui.settings, mix: { night: +mix.night.toFixed(2), rain: +mix.rain.toFixed(2), morning: +mix.morning.toFixed(2) } }, null, 1).replace(/\n\s*/g, ' ');
  input.endFrame();
  requestAnimationFrame(loop);
};
loop();
