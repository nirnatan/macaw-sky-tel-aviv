import { loopingNoise, random, UPDATE_INTERVAL, type Rig } from './rig';

const TICKS_PER_SECOND = 7; // at full rain
const TICK_SECONDS = 0.05;
const RAIN_LEVEL = 0.14;

/** Soft rain: a bright hiss, a lower patter that swells slowly, and sparse droplet ticks. Everything is built once and gated by gain. */
export function createRain(rig: Rig, destination: AudioNode) {
  const { ctx } = rig;
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(destination);

  const hissHigh = ctx.createBiquadFilter();
  hissHigh.type = 'highpass';
  hissHigh.frequency.value = 1800;
  const hissLow = ctx.createBiquadFilter();
  hissLow.type = 'lowpass';
  hissLow.frequency.value = 9000;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 1.7;
  loopingNoise(rig).connect(hissHigh).connect(hissLow).connect(hissGain).connect(bus);

  const patter = ctx.createBiquadFilter();
  patter.type = 'bandpass';
  patter.frequency.value = 650;
  patter.Q.value = 0.55;
  const patterGain = ctx.createGain();
  patterGain.gain.value = 1.7;
  loopingNoise(rig).connect(patter).connect(patterGain).connect(bus);
  const swell = ctx.createOscillator();
  swell.frequency.value = 0.17;
  const swellDepth = ctx.createGain();
  swellDepth.gain.value = 0.5;
  swell.connect(swellDepth).connect(patterGain.gain);
  swell.start();

  const tickBand = ctx.createBiquadFilter();
  tickBand.type = 'bandpass';
  tickBand.Q.value = 5;
  tickBand.frequency.value = 3000;
  const tickGain = ctx.createGain();
  tickGain.gain.value = 0.0001;
  loopingNoise(rig).connect(tickBand).connect(tickGain).connect(bus);
  const tickSend = ctx.createGain();
  tickSend.gain.value = 0.25;
  tickGain.connect(tickSend).connect(rig.reverb);

  let tickFreeAt = 0;
  return {
    update(amount: number) {
      const now = ctx.currentTime;
      bus.gain.setTargetAtTime(RAIN_LEVEL * amount, now, 0.8);
      if (amount < 0.05 || Math.random() > amount * TICKS_PER_SECOND * UPDATE_INTERVAL) return;
      const at = now + Math.random() * UPDATE_INTERVAL;
      if (at < tickFreeAt) return;
      tickFreeAt = at + TICK_SECONDS;
      tickBand.frequency.setValueAtTime(random(1800, 5200), at);
      tickGain.gain.setValueAtTime(0.0001, at);
      tickGain.gain.exponentialRampToValueAtTime(random(0.5, 1.1), at + 0.004);
      tickGain.gain.exponentialRampToValueAtTime(0.0001, at + TICK_SECONDS);
    },
  };
}
