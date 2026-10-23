import * as THREE from 'three';
import type { Macaw, PlayerName, Quality, Species, TargetHud, TargetId } from './contracts';
import { createAudio } from './audio';
import { createEnvironment } from './env';
import { createLandmarks } from './game/landmarks';
import { createInput } from './input';
import { createMacaw } from './macaw';
import { ChaseCamera } from './player/camera';
import { Player, type WorldQuery } from './player/controller';
import { createUI } from './ui';
import { createCity } from './world/city';
import { loadCityData } from './world/data';
import { project } from './geo';

const START = project(32.0835, 34.7685); // Gordon beach
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

function detectQuality(): Quality {
  const touch = navigator.maxTouchPoints > 1;
  const small = Math.min(screen.width, screen.height) < 500;
  return small ? 'low' : touch ? 'medium' : 'high';
}

function foundKey(player: PlayerName) { return `macaw-found-${player}`; }
function loadFound(player: PlayerName): Set<TargetId> {
  try { return new Set(JSON.parse(localStorage.getItem(foundKey(player)) ?? '[]')); } catch { return new Set(); }
}
function saveFound(player: PlayerName, found: Set<TargetId>) {
  try { localStorage.setItem(foundKey(player), JSON.stringify([...found])); } catch { /* private mode */ }
}

async function boot() {
  const root = document.getElementById('app')!;
  const bootLoader = document.getElementById('boot-loader');
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'game-canvas';
  root.appendChild(renderer.domElement);

  const input = createInput(root);
  const data = await loadCityData();
  const ui = createUI({ root, data, input });
  bootLoader?.remove();
  ui.setLoading(0.25, 'בונים את תל אביב… · Building Tel Aviv…');
  await nextFrame();

  let quality: Quality = ui.settings.quality === 'auto' ? detectQuality() : ui.settings.quality;
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 30000);
  const env = createEnvironment({ renderer, scene, camera, sea: data.sea, quality });
  ui.setLoading(0.45);
  await nextFrame();
  const city = createCity(data, { scene, quality, sunDirection: env.sunDirection });
  ui.setLoading(0.8, 'מקשטים את הגן ובית הספר… · Decorating the school and the gan…');
  await nextFrame();
  const landmarks = createLandmarks(data, { scene, quality });
  const audio = createAudio();

  const world: WorldQuery = {
    surfaceAt(x, z, belowY) {
      const c = city.surfaceAt(x, z, belowY);
      const l = landmarks.surfaceAt(x, z, belowY);
      return l && l.height >= c.height ? l : c;
    },
    collide: (center, radius) => city.collide(center, radius),
  };

  const macaws = new Map<Species, Macaw>();
  let species: Species = 'blueGold';
  let macaw = getMacaw(species);
  function getMacaw(s: Species) {
    let m = macaws.get(s);
    if (!m) { m = createMacaw(s); macaws.set(s, m); }
    return m;
  }
  function setSpecies(s: Species) {
    if (s === species && macaw.object.parent) return;
    macaw.object.removeFromParent();
    species = s;
    macaw = getMacaw(s);
    scene.add(macaw.object);
  }
  scene.add(macaw.object);

  const player = new Player(macaw.footOffset);
  const startYaw = -Math.PI / 2; // facing east, toward the city, with the sunset behind
  player.placeOnGround(START[0], START[1], startYaw, world);
  const chase = new ChaseCamera(camera, renderer.domElement);

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    env.setSize(innerWidth, innerHeight);
  });
  env.setSize(innerWidth, innerHeight);

  type Phase = 'menu' | 'playing' | 'paused';
  let phase: Phase = 'menu';
  let playerName: PlayerName = 'Amit';
  let found = new Set<TargetId>();
  let ringsCollected = 0;
  let menuTime = 0;
  let playTime = 0;
  let lastToast = 0;
  const prevPos = new THREE.Vector3();
  const coast = data.coast;

  ui.onPause((p) => { if (phase !== 'menu') phase = p ? 'paused' : 'playing'; });
  const applySettings = () => {
    audio.setMuted(ui.settings.muted);
    audio.setMusic(ui.settings.music);
    const q = ui.settings.quality === 'auto' ? detectQuality() : ui.settings.quality;
    if (q !== quality) { quality = q; env.setQuality(q); city.setQuality(q); }
  };
  ui.onSettings(applySettings);

  function distanceToCoast(x: number, z: number) {
    let best = Infinity;
    for (let i = 0; i < coast.length - 2; i += 2) {
      const ax = coast[i], az = coast[i + 1], bx = coast[i + 2], bz = coast[i + 3];
      const dx = bx - ax, dz = bz - az;
      const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  }

  function checkTargets() {
    for (const spot of landmarks.spots) {
      if (found.has(spot.id)) continue;
      const d = Math.hypot(player.position.x - spot.position.x, player.position.z - spot.position.z);
      const dy = Math.abs(player.position.y - macaw.footOffset - spot.position.y);
      if (d > spot.radius || dy > 3) continue;
      found.add(spot.id);
      saveFound(playerName, found);
      landmarks.setFound(spot.id);
      landmarks.burst(spot.id);
      audio.found();
      macaw.squawk();
      const all = found.size === landmarks.spots.length;
      ui.celebrate(spot.id, playerName);
      if (all) setTimeout(() => ui.celebrate('all', playerName), 4500);
    }
  }

  function hintFor(): string | null {
    if (!player.flying) {
      return playTime < 30 || player.walkSpeed === 0 ? 'takeoff' : 'walk';
    }
    const near = landmarks.spots.find((s) => !found.has(s.id) && player.position.distanceTo(s.position) < 160);
    if (near) return 'nearTarget';
    if (playTime < 12) return 'flap';
    if (player.altitude < 8 && player.speed > 12) return 'landHere';
    if (playTime < 40) return 'boost';
    return null;
  }

  function hudFrame() {
    const targets: TargetHud[] = landmarks.spots.map((s) => {
      const dx = s.position.x - player.position.x, dz = s.position.z - player.position.z;
      const bearingWorld = Math.atan2(dx, -dz); // 0 = north, clockwise
      return { id: s.id, found: found.has(s.id), distance: Math.hypot(dx, dz), bearing: Math.atan2(Math.sin(bearingWorld - player.heading), Math.cos(bearingWorld - player.heading)) };
    });
    return {
      speed: player.flying ? player.speed : Math.abs(player.walkSpeed),
      altitude: player.altitude,
      mode: player.flying ? 'flying' as const : Math.abs(player.walkSpeed) > 0.05 ? 'walking' as const : 'perched' as const,
      targets,
      player: { x: player.position.x, z: player.position.z, heading: player.heading },
      rings: { collected: ringsCollected, total: landmarks.rings.length },
      hint: hintFor(),
    };
  }

  const clock = new THREE.Clock();
  let fpsAccum = 0, fpsFrames = 0, slowSeconds = 0;

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 1 / 20);
    const inp = input.state;

    if (phase === 'menu') {
      menuTime += dt;
      macaw.object.position.copy(player.position);
      macaw.object.quaternion.copy(player.quaternion);
      macaw.update(dt, { mode: 'idle', effort: 0, bank: 0, pitch: 0, walkSpeed: 0, look: Math.sin(menuTime * 0.7) * 0.6 });
      const a = player.yaw + Math.PI + Math.sin(menuTime * 0.25) * 0.9; // orbit in front of the bird's face
      camera.position.set(player.position.x - Math.sin(a) * 2.1, player.position.y + 0.35, player.position.z - Math.cos(a) * 2.1);
      camera.lookAt(player.position.x, player.position.y + 0.05, player.position.z);
    } else if (phase === 'playing') {
      playTime += dt;
      prevPos.copy(player.position);
      const { anim, events } = player.update(dt, inp, world);
      macaw.object.position.copy(player.position);
      macaw.object.quaternion.copy(player.quaternion);
      macaw.update(dt, anim);

      if (events.flap) audio.flap(events.flap);
      if (inp.squawk) { macaw.squawk(); audio.squawk(species); }
      if (events.landed) { audio.land(); }
      if (!player.flying) checkTargets();
      if (events.blockedByWater && playTime - lastToast > 4) {
        lastToast = playTime;
        ui.toast('אי אפשר לנחות על המים! · Can\'t land on water!');
      }
      if (player.flying) {
        for (const _ of landmarks.collectRings(prevPos, player.position)) { ringsCollected++; audio.ring(); }
      }
      chase.update(dt, player, world);
      ui.updateHud(hudFrame());
    }

    if (phase !== 'paused') {
      const dive = player.flying ? THREE.MathUtils.clamp((player.speed - 26) / 20, 0, 1) : 0;
      env.setSpeedEffect(Math.max(player.boost * 0.8, dive));
      audio.update({ speed: player.flying ? player.speed : 0, altitude: player.altitude, distanceToCoast: distanceToCoast(player.position.x, player.position.z), flying: player.flying, effort: inp.flap ? 1 : 0.3 });
      landmarks.update(dt, camera, player.position);
    }
    env.update(dt, player.position);
    city.update(camera);
    env.render(dt);
    input.endFrame();

    if (ui.settings.quality === 'auto' && phase === 'playing') {
      fpsAccum += dt; fpsFrames++;
      if (fpsAccum > 1) {
        const fps = fpsFrames / fpsAccum;
        slowSeconds = fps < 40 ? slowSeconds + 1 : 0;
        if (slowSeconds >= 4 && quality !== 'low') {
          quality = quality === 'high' ? 'medium' : 'low';
          env.setQuality(quality); city.setQuality(quality);
          renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'medium' ? 1.5 : 1));
          env.setSize(innerWidth, innerHeight);
          slowSeconds = 0;
        }
        fpsAccum = 0; fpsFrames = 0;
      }
    }
  }

  ui.setLoading(1);
  frame();

  const choice = await ui.showStart((c) => setSpecies(c.species));
  setSpecies(choice.species);
  playerName = choice.player;
  found = loadFound(playerName);
  for (const id of found) landmarks.setFound(id);
  await audio.unlock();
  applySettings();
  ui.showHud(true);
  phase = 'playing';
  chase.snap(player, world);
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('boot-loader');
  if (el) el.textContent = 'Oops, something went wrong: ' + (err?.message ?? err);
});
