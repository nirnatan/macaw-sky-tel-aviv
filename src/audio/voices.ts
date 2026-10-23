import type { Species } from '../contracts';
import { envelope, midiToHz, noiseSource, random, type Rig } from './rig';

/** Soft bell: sine partials at inharmonic ratios, each decaying faster than the one below. */
export function bell(rig: Rig, t: number, freq: number, gain: number, duration = 1.4, reverbSend = 0.5) {
  const out = rig.ctx.createGain();
  out.gain.value = gain;
  out.connect(rig.sfx);
  const send = rig.ctx.createGain();
  send.gain.value = reverbSend;
  out.connect(send).connect(rig.reverb);
  [[1, 1, 1], [2.76, 0.32, 0.5], [5.4, 0.12, 0.28], [8.9, 0.05, 0.15]].forEach(([ratio, level, decay]) => {
    const osc = rig.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * ratio!;
    const env = envelope(rig.ctx, t, 0.004, level!, duration * decay!);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + duration * decay! + 0.05);
  });
}

export function flap(rig: Rig, strength: number) {
  const { ctx } = rig;
  const t = ctx.currentTime + 0.005;
  const duration = 0.2 + 0.14 * strength;
  const source = noiseSource(rig, t, duration + 0.05);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 0.8;
  const pitch = random(0.9, 1.1);
  band.frequency.setValueAtTime(300 * pitch, t);
  band.frequency.exponentialRampToValueAtTime((850 + 700 * strength) * pitch, t + duration * 0.4);
  band.frequency.exponentialRampToValueAtTime(380 * pitch, t + duration);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.4 + 0.8 * strength, t + duration * 0.35);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  source.connect(band).connect(env).connect(rig.sfx);

  const thump = ctx.createOscillator();
  thump.frequency.setValueAtTime(95, t);
  thump.frequency.exponentialRampToValueAtTime(48, t + 0.14);
  const thumpEnv = envelope(ctx, t, 0.01, 0.22 * strength, 0.16);
  thump.connect(thumpEnv).connect(rig.sfx);
  thump.start(t);
  thump.stop(t + 0.2);
}

interface MacawVoice {
  base: number; // Hz, carrier pitch
  duration: number;
  fmIndex: number; // FM depth as a fraction of carrier pitch
  rasp: number; // Hz, amplitude roughness
  breath: number; // 0..1 noise level
  formants: [number, number, number];
}
const VOICES: Record<Species, MacawVoice> = {
  blueGold: { base: 760, duration: 0.64, fmIndex: 0.5, rasp: 52, breath: 0.22, formants: [820, 1650, 2800] }, // bigger bird: lower, rounder
  scarlet: { base: 960, duration: 0.54, fmIndex: 0.75, rasp: 68, breath: 0.32, formants: [950, 2000, 3300] }, // sharper, raspier
};

// Pitch multiplier over the call: quick rise, slight sag, then a falling "awk".
const contour = (u: number) => {
  if (u < 0.14) return 0.82 + 0.5 * (u / 0.14) ** 0.7;
  if (u < 0.62) return 1.32 - 0.3 * ((u - 0.14) / 0.48);
  return 1.02 - 0.42 * ((u - 0.62) / 0.38) ** 1.4;
};
const CURVE_POINTS = 96;
const curve = (scale: (u: number) => number) => Float32Array.from({ length: CURVE_POINTS }, (_, i) => scale(i / (CURVE_POINTS - 1)));

export function squawk(rig: Rig, species: Species) {
  const { ctx } = rig;
  const voice = VOICES[species];
  const t = ctx.currentTime + 0.005;
  const base = voice.base * random(0.95, 1.07);
  const duration = voice.duration * random(0.92, 1.08);

  const sum = ctx.createGain();
  const carrier = ctx.createOscillator();
  carrier.type = 'sawtooth';
  carrier.frequency.setValueCurveAtTime(curve((u) => base * contour(u)), t, duration);
  const growl = ctx.createOscillator();
  growl.type = 'square';
  growl.frequency.setValueCurveAtTime(curve((u) => (base * contour(u)) / 2), t, duration);
  const growlGain = ctx.createGain();
  growlGain.gain.value = 0.22;
  const modulator = ctx.createOscillator();
  modulator.frequency.setValueCurveAtTime(curve((u) => base * contour(u) * 1.51), t, duration);
  const modDepth = ctx.createGain();
  modDepth.gain.setValueCurveAtTime(curve((u) => base * contour(u) * voice.fmIndex * (0.5 + 0.5 * Math.sin(Math.PI * u))), t, duration);
  modulator.connect(modDepth).connect(carrier.frequency);
  const flutter = ctx.createOscillator(); // fast pitch jitter, the screechy part
  flutter.frequency.value = random(24, 34);
  const flutterDepth = ctx.createGain();
  flutterDepth.gain.value = base * 0.035;
  flutter.connect(flutterDepth).connect(carrier.frequency);
  carrier.connect(sum);
  growl.connect(growlGain).connect(sum);

  const breath = noiseSource(rig, t, duration);
  const breathBand = ctx.createBiquadFilter();
  breathBand.type = 'bandpass';
  breathBand.frequency.value = 2600;
  breathBand.Q.value = 1.2;
  const breathGain = ctx.createGain();
  breathGain.gain.value = voice.breath;
  breath.connect(breathBand).connect(breathGain).connect(sum);

  const rough = ctx.createGain();
  rough.gain.value = 0.62;
  const roughLfo = ctx.createOscillator();
  roughLfo.frequency.value = voice.rasp * random(0.9, 1.1);
  const roughDepth = ctx.createGain();
  roughDepth.gain.value = 0.38;
  roughLfo.connect(roughDepth).connect(rough.gain);

  const drive = ctx.createWaveShaper();
  drive.curve = Float32Array.from({ length: 512 }, (_, i) => Math.tanh(((i / 511) * 2 - 1) * 3));
  sum.connect(rough).connect(drive);

  const formantMix = ctx.createGain();
  voice.formants.forEach((freq, i) => {
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = [5, 7, 8][i]!;
    filter.frequency.setValueCurveAtTime(curve((u) => freq * (0.82 + 0.3 * Math.sin(Math.PI * Math.min(1, u * 1.2)))), t, duration);
    const level = ctx.createGain();
    level.gain.value = [1, 0.9, 0.5][i]!;
    drive.connect(filter).connect(level).connect(formantMix);
  });
  const dry = ctx.createGain();
  dry.gain.value = 0.25;
  drive.connect(dry).connect(formantMix);

  const amp = ctx.createGain(); // two pulses ("raa-awk") with a hard stop
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(0.9, t + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.55, t + duration * 0.38);
  amp.gain.exponentialRampToValueAtTime(0.95, t + duration * 0.5);
  amp.gain.exponentialRampToValueAtTime(0.7, t + duration * 0.88);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 320;
  const level = ctx.createGain();
  level.gain.value = 0.34;
  formantMix.connect(amp).connect(highpass).connect(level).connect(rig.sfx);
  const send = ctx.createGain();
  send.gain.value = 0.18;
  level.connect(send).connect(rig.reverb);

  const click = noiseSource(rig, t + duration - 0.04, 0.06); // the "k"
  const clickBand = ctx.createBiquadFilter();
  clickBand.type = 'highpass';
  clickBand.frequency.value = 2400;
  const clickEnv = envelope(ctx, t + duration - 0.04, 0.004, 0.25, 0.05);
  click.connect(clickBand).connect(clickEnv).connect(level);

  for (const node of [carrier, growl, modulator, flutter, roughLfo]) { node.start(t); node.stop(t + duration + 0.05); }
}

const PENTATONIC = [72, 74, 76, 79, 81, 84];

/** Collect chime; `step` climbs a pentatonic ladder for rings caught in quick succession. */
export function ring(rig: Rig, step: number) {
  const t = rig.ctx.currentTime + 0.005;
  const note = PENTATONIC[Math.min(step, PENTATONIC.length - 1)]!;
  bell(rig, t, midiToHz(note), 0.32, 1.3);
  bell(rig, t + 0.075, midiToHz(note + 7), 0.26, 1.5);
}

function brass(rig: Rig, t: number, freq: number, duration: number, gain: number) {
  const { ctx } = rig;
  const out = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 2;
  filter.frequency.setValueAtTime(700, t);
  filter.frequency.exponentialRampToValueAtTime(3200, t + 0.06);
  filter.frequency.exponentialRampToValueAtTime(1400, t + duration);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.025);
  env.gain.setValueAtTime(gain * 0.85, t + duration * 0.7);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration + 0.12);
  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5.5;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = freq * 0.006;
  vibrato.connect(vibratoDepth);
  for (const detune of [-6, 6]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = detune;
    vibratoDepth.connect(osc.frequency);
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + duration + 0.2);
  }
  vibrato.start(t);
  vibrato.stop(t + duration + 0.2);
  filter.connect(env).connect(out);
  out.connect(rig.sfx);
  const send = ctx.createGain();
  send.gain.value = 0.3;
  out.connect(send).connect(rig.reverb);
}

/** Happy "you found it" fanfare: brass call, bell sparkle, chord. */
export function found(rig: Rig) {
  const t = rig.ctx.currentTime + 0.02;
  rig.duckMusic(3.4);
  const call: [number, number, number][] = [[67, 0, 0.13], [72, 0.15, 0.13], [76, 0.3, 0.13], [79, 0.45, 0.55], [76, 1.05, 0.13], [79, 1.2, 1.1]];
  for (const [note, at, length] of call) brass(rig, t + at, midiToHz(note), length, 0.17);
  for (const note of [60, 64, 67, 72]) brass(rig, t + 1.2, midiToHz(note), 1.2, 0.07);
  for (let i = 0; i < 14; i++) {
    const note = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)]! + (Math.random() < 0.3 ? 12 : 0);
    bell(rig, t + 0.45 + i * 0.1, midiToHz(note), 0.22 * (1 - i / 18), 1.6, 0.7);
  }
  bell(rig, t + 1.2, midiToHz(96), 0.18, 2.4, 0.8);
}

export function land(rig: Rig) {
  const { ctx } = rig;
  const t = ctx.currentTime + 0.005;
  const body = ctx.createOscillator();
  body.frequency.setValueAtTime(150, t);
  body.frequency.exponentialRampToValueAtTime(42, t + 0.22);
  body.connect(envelope(ctx, t, 0.006, 0.7, 0.3)).connect(rig.sfx);
  body.start(t);
  body.stop(t + 0.35);

  const thud = noiseSource(rig, t, 0.2);
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 520;
  thud.connect(low).connect(envelope(ctx, t, 0.004, 0.55, 0.14)).connect(rig.sfx);

  const feathers = noiseSource(rig, t + 0.03, 0.25);
  const high = ctx.createBiquadFilter();
  high.type = 'bandpass';
  high.frequency.value = 2200;
  high.Q.value = 0.7;
  feathers.connect(high).connect(envelope(ctx, t + 0.03, 0.03, 0.1, 0.22)).connect(rig.sfx);
}
