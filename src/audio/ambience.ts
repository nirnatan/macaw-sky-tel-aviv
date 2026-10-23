import { clamp01, smoothstep, type Rig } from './rig';

export interface AmbienceParams { speed: number; altitude: number; distanceToCoast: number; flying: boolean; effort: number }

const MAX_SPEED = 38; // m/s that maps to full wind

/** Looping noise through filters and gains, retuned a few times per second from the flight state. */
export function createAmbience(rig: Rig, destination: AudioNode) {
  const { ctx } = rig;
  const loop = (): AudioBufferSourceNode => {
    const source = ctx.createBufferSource();
    source.buffer = rig.noise;
    source.loop = true;
    source.start(0, Math.random() * rig.noise.duration); // random offset so layers do not phase together
    return source;
  };

  const windLow = ctx.createBiquadFilter();
  windLow.type = 'lowpass';
  windLow.Q.value = 0.6;
  const windHigh = ctx.createBiquadFilter();
  windHigh.type = 'highpass';
  windHigh.frequency.value = 120;
  const windGain = ctx.createGain();
  windGain.gain.value = 0;
  loop().connect(windLow).connect(windHigh).connect(windGain).connect(destination);

  const gustBand = ctx.createBiquadFilter(); // slow gusts: the band wanders so the wind never sounds static
  gustBand.type = 'bandpass';
  gustBand.Q.value = 1.1;
  gustBand.frequency.value = 900;
  const gustGain = ctx.createGain();
  gustGain.gain.value = 0;
  loop().connect(gustBand).connect(gustGain).connect(destination);
  const gustLfo = ctx.createOscillator();
  gustLfo.frequency.value = 0.23;
  const gustFreqDepth = ctx.createGain();
  gustFreqDepth.gain.value = 500;
  gustLfo.connect(gustFreqDepth).connect(gustBand.frequency);
  gustLfo.start();

  const seaProximity = ctx.createGain();
  seaProximity.gain.value = 0;
  seaProximity.connect(destination);
  const swellLfos = [0.115, 0.071];
  const wash = ctx.createBiquadFilter();
  wash.type = 'lowpass';
  wash.frequency.value = 520;
  const washSwell = ctx.createGain();
  washSwell.gain.value = 0.5;
  loop().connect(wash).connect(washSwell).connect(seaProximity);
  const foam = ctx.createBiquadFilter();
  foam.type = 'highpass';
  foam.frequency.value = 1700;
  const foamSwell = ctx.createGain();
  foamSwell.gain.value = 0.12;
  loop().connect(foam).connect(foamSwell).connect(seaProximity);
  swellLfos.forEach((hz, i) => {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = hz;
    const depth = ctx.createGain();
    depth.gain.value = i === 0 ? 0.3 : 0.18;
    lfo.connect(depth);
    depth.connect(washSwell.gain);
    const foamDepth = ctx.createGain();
    foamDepth.gain.value = 0.07;
    depth.connect(foamDepth).connect(foamSwell.gain);
    const washBright = ctx.createGain();
    washBright.gain.value = 260;
    lfo.connect(washBright).connect(wash.frequency);
    lfo.start(ctx.currentTime + i * 1.7);
  });

  return {
    update(p: AmbienceParams) {
      const now = ctx.currentTime;
      const speed = clamp01(p.speed / MAX_SPEED);
      const height = clamp01(p.altitude / 250);
      const windLevel = p.flying ? 0.05 + 0.55 * speed ** 1.3 * (0.85 + 0.15 * p.effort) : 0.02 + 0.1 * speed;
      windGain.gain.setTargetAtTime(windLevel, now, 0.12);
      windLow.frequency.setTargetAtTime(260 + 2600 * speed + 500 * height, now, 0.12);
      gustGain.gain.setTargetAtTime(windLevel * (0.35 + 0.4 * height), now, 0.2);
      const nearSea = 1 - smoothstep(250, 3200, p.distanceToCoast);
      seaProximity.gain.setTargetAtTime(0.75 * nearSea * (1 - 0.55 * height), now, 0.4);
    },
  };
}
