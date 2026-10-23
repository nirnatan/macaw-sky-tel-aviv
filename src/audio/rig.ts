/** Shared plumbing every procedural voice plugs into. Works on both live and offline contexts so voices can be rendered and inspected. */
export interface Rig {
  ctx: BaseAudioContext;
  sfx: AudioNode; // dry effects bus
  reverb: AudioNode; // reverb send
  noise: AudioBuffer; // looping pink noise
  duckMusic(seconds: number): void;
}

export const midiToHz = (note: number) => 440 * 2 ** ((note - 69) / 12);
export const random = (min: number, max: number) => min + Math.random() * (max - min);
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export function makePinkNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759; b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856; b4 = 0.55 * b4 + white * 0.5329522; b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return buffer;
}

/** Synthetic hall: decaying stereo noise. */
export function makeReverbImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
  }
  return impulse;
}

/** Gain node with an attack/decay envelope already scheduled; `peak` reached after `attack`, silent at `t + duration`. */
export function envelope(ctx: BaseAudioContext, t: number, attack: number, peak: number, duration: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  return g;
}

export function noiseSource(rig: Rig, t: number, duration: number): AudioBufferSourceNode {
  const source = rig.ctx.createBufferSource();
  source.buffer = rig.noise;
  source.loop = true;
  source.start(t, random(0, rig.noise.duration - 0.5));
  source.stop(t + duration);
  return source;
}
