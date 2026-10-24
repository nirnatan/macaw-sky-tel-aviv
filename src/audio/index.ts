import type { AudioEngine, AudioMix, Species } from '../contracts';
import { createAmbience } from './ambience';
import { createMusic } from './music';
import { makePinkNoise, makeReverbImpulse, nightAmount, UPDATE_INTERVAL, type Rig } from './rig';
import * as voices from './voices';

const MUSIC_LEVEL = 0.26;
const RING_COMBO_WINDOW = 2.5; // seconds

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

export function createAudio(): AudioEngine {
  let muted = false;
  let musicOn = true;
  let graph: {
    ctx: AudioContext; rig: Rig; master: GainNode; musicBus: GainNode;
    ambience: ReturnType<typeof createAmbience>; music: ReturnType<typeof createMusic>;
  } | null = null;
  let lastUpdate = 0;
  let ringStep = 0;
  let lastRingAt = -Infinity;

  const build = () => {
    const Context = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext!;
    const ctx = new Context({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 24;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;
    master.connect(compressor).connect(ctx.destination);

    const sfx = ctx.createGain();
    sfx.gain.value = 0.9;
    sfx.connect(master);
    const reverb = ctx.createConvolver();
    reverb.buffer = makeReverbImpulse(ctx, 2.4, 2.4);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.5;
    reverb.connect(reverbReturn).connect(master);
    const reverbIn = ctx.createGain();
    reverbIn.connect(reverb);
    const ambienceBus = ctx.createGain();
    ambienceBus.gain.value = 1.6;
    ambienceBus.connect(master);
    const musicBus = ctx.createGain();
    musicBus.gain.value = musicOn ? MUSIC_LEVEL : 0;
    musicBus.connect(master);

    let music: ReturnType<typeof createMusic>;
    const rig: Rig = { ctx, sfx, reverb: reverbIn, noise: makePinkNoise(ctx, 4), duckMusic: (s) => music.duck(s) };
    music = createMusic(rig, musicBus);
    const ambience = createAmbience(rig, ambienceBus);
    if (musicOn) music.start();
    document.addEventListener('visibilitychange', () => { if (document.hidden) void ctx.suspend(); else void ctx.resume(); });
    graph = { ctx, rig, master, musicBus, ambience, music };
  };

  const unlock = async () => {
    if (!graph) build();
    if (graph!.ctx.state !== 'running') await graph!.ctx.resume();
  };

  const firstGesture = () => { void unlock(); };
  for (const type of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(type, firstGesture, { once: true, capture: true });

  const play = (fn: (rig: Rig) => void) => { if (graph && graph.ctx.state === 'running') fn(graph.rig); };

  return {
    unlock,
    update(p: AudioMix) {
      if (!graph) return;
      const now = graph.ctx.currentTime;
      if (now - lastUpdate < UPDATE_INTERVAL) return;
      lastUpdate = now;
      graph.ambience.update(p);
      graph.music.setMood(nightAmount(p.night));
    },
    flap: (strength) => play((rig) => voices.flap(rig, Math.min(1, Math.max(0, strength)))),
    squawk: (species: Species) => play((rig) => voices.squawk(rig, species)),
    ring() {
      play((rig) => {
        const now = rig.ctx.currentTime;
        ringStep = now - lastRingAt < RING_COMBO_WINDOW ? ringStep + 1 : 0;
        lastRingAt = now;
        voices.ring(rig, ringStep);
      });
    },
    found: () => play(voices.found),
    land: () => play(voices.land),
    setMuted(m) {
      muted = m;
      graph?.master.gain.setTargetAtTime(m ? 0 : 1, graph.ctx.currentTime, 0.05);
    },
    setMusic(on) {
      musicOn = on;
      if (!graph) return;
      graph.musicBus.gain.setTargetAtTime(on ? MUSIC_LEVEL : 0, graph.ctx.currentTime, 0.3);
      if (on) graph.music.start(); else graph.music.stop();
    },
  };
}
