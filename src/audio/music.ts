import { envelope, midiToHz, random, type Rig } from './rig';

const BPM = 84;
const EIGHTH = 60 / BPM / 2;
const STEPS_PER_CHORD = 16;
const LOOKAHEAD = 0.9; // seconds scheduled ahead of the clock
const TICK_MS = 250;

const CHORDS = [
  { root: 36, pad: [60, 64, 67, 71] }, // Cmaj7
  { root: 43, pad: [59, 62, 67, 74] }, // G
  { root: 33, pad: [57, 60, 64, 67] }, // Am7
  { root: 41, pad: [57, 60, 65, 69] }, // F
];
const SCALE = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81]; // C major pentatonic, two octaves

/** Calm generative loop: slow pad chords, a soft bass, and sparse pentatonic plucks through a dotted echo. */
export function createMusic(rig: Rig, destination: AudioNode) {
  const { ctx } = rig;
  const input = ctx.createGain();
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 4200;
  const ducker = ctx.createGain();
  input.connect(tone).connect(ducker).connect(destination);
  const reverbSend = ctx.createGain();
  reverbSend.gain.value = 0.4;
  ducker.connect(reverbSend).connect(rig.reverb);

  const echo = ctx.createDelay(2);
  echo.delayTime.value = EIGHTH * 3;
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = 'lowpass';
  echoTone.frequency.value = 2200;
  const echoFeedback = ctx.createGain();
  echoFeedback.gain.value = 0.34;
  const echoLevel = ctx.createGain();
  echoLevel.gain.value = 0.38;
  echo.connect(echoTone).connect(echoFeedback).connect(echo);
  echoTone.connect(echoLevel).connect(input);

  const pad = (t: number, notes: number[], seconds: number) => {
    for (const note of notes) for (const detune of [-7, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToHz(note);
      osc.detune.value = detune;
      const warm = ctx.createBiquadFilter();
      warm.type = 'lowpass';
      warm.frequency.value = 720;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.026, t + 1.8);
      env.gain.setValueAtTime(0.026, t + seconds - 0.4);
      env.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 2);
      osc.connect(warm).connect(env).connect(input);
      osc.start(t);
      osc.stop(t + seconds + 2.1);
    }
  };

  const bass = (t: number, note: number) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = midiToHz(note);
    osc.connect(envelope(ctx, t, 0.03, 0.2, 1.6)).connect(input);
    osc.start(t);
    osc.stop(t + 1.7);
  };

  const pluck = (t: number, note: number, velocity: number) => {
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = midiToHz(note);
    const shine = ctx.createOscillator();
    shine.frequency.value = midiToHz(note + 12);
    const shineGain = ctx.createGain();
    shineGain.gain.value = 0.25;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(3600, t);
    lowpass.frequency.exponentialRampToValueAtTime(900, t + 0.5);
    const env = envelope(ctx, t, 0.006, 0.11 * velocity, 1.1);
    body.connect(lowpass);
    shine.connect(shineGain).connect(lowpass);
    lowpass.connect(env);
    env.connect(input);
    env.connect(echo);
    for (const osc of [body, shine]) { osc.start(t); osc.stop(t + 1.2); }
  };

  let timer = 0;
  let nextTime = 0;
  let step = 0;
  let lastIndex = 4;

  const scheduleStep = () => {
    const chord = CHORDS[Math.floor(step / STEPS_PER_CHORD) % CHORDS.length]!;
    const inChord = step % STEPS_PER_CHORD;
    if (inChord === 0) { pad(nextTime, chord.pad, STEPS_PER_CHORD * EIGHTH); bass(nextTime, chord.root); }
    if (inChord === 8) bass(nextTime, chord.root + (Math.random() < 0.5 ? 7 : 0));
    const strong = inChord % 4 === 0;
    if (Math.random() < (strong ? 0.6 : 0.26) && inChord < STEPS_PER_CHORD - 2) {
      lastIndex = Math.min(SCALE.length - 1, Math.max(0, lastIndex + Math.round(random(-3, 3)) || 1));
      pluck(nextTime, SCALE[lastIndex]!, strong ? random(0.8, 1) : random(0.45, 0.75));
    }
    nextTime += EIGHTH;
    step++;
  };
  const tick = () => {
    if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.1; // after a suspend, resync instead of bursting
    while (nextTime < ctx.currentTime + LOOKAHEAD) scheduleStep();
  };

  return {
    start() {
      if (timer) return;
      nextTime = ctx.currentTime + 0.15;
      step = 0;
      input.gain.cancelScheduledValues(ctx.currentTime);
      input.gain.setValueAtTime(0.0001, ctx.currentTime);
      input.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 2.5);
      tick();
      timer = window.setInterval(tick, TICK_MS);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = 0;
      input.gain.cancelScheduledValues(ctx.currentTime);
      input.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25);
    },
    duck(seconds: number) {
      const now = ctx.currentTime;
      ducker.gain.cancelScheduledValues(now);
      ducker.gain.setTargetAtTime(0.3, now, 0.15);
      ducker.gain.setTargetAtTime(1, now + seconds, 0.6);
    },
  };
}
