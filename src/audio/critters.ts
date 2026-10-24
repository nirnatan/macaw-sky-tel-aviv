import { random, UPDATE_INTERVAL, type Rig } from './rig';

const CRICKETS = [
  { carrierHz: 4300, pulseHz: 24, burstHz: 2.3 },
  { carrierHz: 4800, pulseHz: 31, burstHz: 1.7 },
];
const CRICKET_LEVEL = 0.027;

const BIRD_VOICES = 3;
const BIRD_LEVEL = 0.1;
const MOTIFS_PER_SECOND = 0.7; // at full birdsong

const stepCurve = (from: number, to: number) => {
  const curve = new Float32Array(256);
  for (let i = 0; i < curve.length; i++) {
    const t = Math.min(1, Math.max(0, ((i / (curve.length - 1)) * 2 - 1 - from) / (to - from)));
    curve[i] = t * t * (3 - 2 * t);
  }
  return curve;
};

/** Two soft cricket trills: a sine carrier pulsed fast and gated into bursts by slow LFOs. Built once, gated by gain. */
export function createCrickets(rig: Rig, destination: AudioNode) {
  const { ctx } = rig;
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(destination);
  const burstShape = stepCurve(-0.25, 0.25);

  for (const voice of CRICKETS) {
    const carrier = ctx.createOscillator();
    carrier.frequency.value = voice.carrierHz;
    const pulse = ctx.createGain();
    pulse.gain.value = 0.5;
    const pulseLfo = ctx.createOscillator();
    pulseLfo.frequency.value = voice.pulseHz;
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.5;
    pulseLfo.connect(pulseDepth).connect(pulse.gain);

    const burst = ctx.createGain();
    burst.gain.value = 0;
    const burstLfo = ctx.createOscillator();
    burstLfo.frequency.value = voice.burstHz;
    const shaper = ctx.createWaveShaper();
    shaper.curve = burstShape;
    burstLfo.connect(shaper).connect(burst.gain);

    carrier.connect(pulse).connect(burst).connect(bus);
    carrier.start();
    pulseLfo.start();
    burstLfo.start(ctx.currentTime + random(0, 1)); // the two voices drift in and out of step
  }

  return {
    update(level: number) {
      bus.gain.setTargetAtTime(CRICKET_LEVEL * level, ctx.currentTime, 0.6);
    },
  };
}

/** A few sine voices that sing short rising or falling chirp motifs at random. Built once; update() only schedules parameter ramps. */
export function createBirds(rig: Rig, destination: AudioNode) {
  const { ctx } = rig;
  const bus = ctx.createGain();
  bus.gain.value = BIRD_LEVEL;
  bus.connect(destination);
  const send = ctx.createGain();
  send.gain.value = 0.3;
  bus.connect(send).connect(rig.reverb);

  const voices = Array.from({ length: BIRD_VOICES }, () => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    env.gain.value = 0.0001;
    osc.connect(env).connect(bus);
    osc.start();
    return { osc, env, freeAt: 0 };
  });

  const sing = (voice: (typeof voices)[number], start: number, loudness: number) => {
    const chirps = Math.floor(random(2, 5));
    const base = random(2300, 3600);
    const rising = Math.random() < 0.6;
    let t = start;
    for (let i = 0; i < chirps; i++) {
      const duration = random(0.06, 0.1);
      const from = base * (1 + 0.06 * i * (rising ? 1 : -1));
      voice.osc.frequency.setValueAtTime(from, t);
      voice.osc.frequency.exponentialRampToValueAtTime(from * (rising ? 1.3 : 0.75), t + duration);
      voice.env.gain.setValueAtTime(0.0001, t);
      voice.env.gain.exponentialRampToValueAtTime(loudness * random(0.7, 1), t + duration * 0.25);
      voice.env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      t += duration + random(0.04, 0.08);
    }
    voice.freeAt = t + 0.1;
  };

  return {
    update(level: number) {
      if (level < 0.02 || Math.random() > level * MOTIFS_PER_SECOND * UPDATE_INTERVAL) return;
      const now = ctx.currentTime;
      const voice = voices.find((v) => v.freeAt < now);
      if (voice) sing(voice, now + Math.random() * UPDATE_INTERVAL, level);
    },
  };
}
