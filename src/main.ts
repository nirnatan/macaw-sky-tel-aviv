import * as THREE from 'three';
import type { Lighting, Macaw, PlayerName, Quality, Species, TargetHud, TargetId } from './contracts';
import { createAudio } from './audio';
import { createEnvironment } from './env';
import { createRain } from './fx/rain';
import { createTurboFlames } from './fx/turbo-flames';
import { createLandmarks } from './game/landmarks';
import { createInput } from './input';
import { createMacaw } from './macaw';
import { ChaseCamera } from './player/camera';
import { Player, type WorldQuery } from './player/controller';
import { createUI } from './ui';
import { createCity } from './world/city';
import { loadCityData } from './world/data';
import { project } from './geo';

const START = project(32.0835, 34.7674); // on the sand at Gordon beach
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
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; // env owns shadow type and pixel ratio per quality tier
  renderer.domElement.className = 'game-canvas';
  root.appendChild(renderer.domElement);

  const input = createInput(root);
  const data = await loadCityData();
  const ui = createUI({ root, data, input });
  bootLoader?.remove();
  ui.setLoading(0.25, 'בונים את תל אביב… · Building Tel Aviv…');
  await nextFrame();

  let quality: Quality = ui.settings.quality === 'auto' ? detectQuality() : ui.settings.quality;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 30000);
  const env = createEnvironment({ renderer, scene, camera, sea: data.sea, quality });
  env.setConditions(ui.settings, { instant: true }); // the first frame is already the saved time of day
  ui.setLoading(0.45);
  await nextFrame();
  const city = createCity(data, { scene, quality });
  scene.add(city.group);
  ui.setLoading(0.8, 'מקשטים את המקומות המיוחדים… · Decorating the special places…');
  await nextFrame();
  const landmarks = createLandmarks(data, { scene, quality });
  const audio = createAudio();
  const flames = createTurboFlames({ quality });
  scene.add(flames.object);
  const wingTips = [new THREE.Vector3(), new THREE.Vector3()] as const;
  const velocity = new THREE.Vector3();

  const world: WorldQuery = {
    surfaceAt(x, z, belowY) {
      const c = city.surfaceAt(x, z, belowY);
      const l = landmarks.surfaceAt(x, z, belowY);
      return l && l.height >= c.height ? l : c;
    },
    collide: (center, radius) => city.collide(center, radius),
  };
  const rain = createRain({ quality, surfaceAt: (x, z, b) => world.surfaceAt(x, z, b) });
  scene.add(rain.object);

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
  const firstRing = landmarks.rings[0]?.position;
  const startYaw = firstRing ? Math.atan2(-(firstRing.x - START[0]), -(firstRing.z - START[1])) : -Math.PI / 2;
  player.placeOnGround(START[0], START[1], Math.PI / 2, world); // on the menu the bird faces the sunset, so its face is sunlit
  const chase = new ChaseCamera(camera, renderer.domElement);
  const HERO_WARM = new THREE.Color(0xffeedd), HERO_MOON = new THREE.Color(0xcfd8ff);
  const heroLight = new THREE.PointLight(HERO_WARM, 3, 7, 2); // short-range fill so the macaw reads; never hidden (light count is in every program key)
  scene.add(heroLight);
  const heroOffset = new THREE.Vector3(0.6, 0.8, 0);

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
  let conditionsKey = `${ui.settings.time}|${ui.settings.rain}`;
  const applySettings = () => {
    audio.setMuted(ui.settings.muted);
    audio.setMusic(ui.settings.music);
    const key = `${ui.settings.time}|${ui.settings.rain}`;
    if (key !== conditionsKey) { conditionsKey = key; env.setConditions(ui.settings); } // sound or quality toggles never restart a blend
    const q = ui.settings.quality === 'auto' ? detectQuality() : ui.settings.quality;
    if (q !== quality) { quality = q; setQualityEverywhere(q); }
  };
  function setQualityEverywhere(q: Quality) {
    env.setQuality(q); city.setQuality(q); flames.setQuality(q); rain.setQuality(q);
  }
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

  function nearestUnfoundSpot(within: number) {
    let best: (typeof landmarks.spots)[number] | null = null, bestD = within;
    for (const s of landmarks.spots) {
      const d = Math.hypot(s.position.x - player.position.x, s.position.z - player.position.z);
      if (!found.has(s.id) && d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  function checkTargets() {
    for (const spot of landmarks.spots) {
      if (found.has(spot.id)) continue;
      const d = Math.hypot(player.position.x - spot.position.x, player.position.z - spot.position.z);
      const feetY = player.position.y - macaw.footOffset;
      if (d > spot.radius + 4 || feetY > spot.position.y + 3) continue; // roof or the yard below it both count
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

  // Night and rain objects compile on their first visible draw, so compile everything once, all on, behind the loader.
  async function warmUpShaders() {
    const allOn: Lighting = {
      sunDirection: new THREE.Vector3(0, 1, 0), sunColor: new THREE.Color(1, 1, 1), hazeColor: new THREE.Color(0.5, 0.5, 0.5),
      night: 1, morning: 1, rain: 1, wetness: 1, overcast: 1, rainbow: 1,
    };
    const birds = (['blueGold', 'scarlet'] as const).map(getMacaw);
    for (const b of birds) { if (!b.object.parent) scene.add(b.object); b.applyLighting(allOn); }
    city.applyLighting(allOn);
    landmarks.applyLighting(allOn);
    rain.update(0, allOn, camera);
    const linearTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }); // the composer renders into linear half-float, so compile those variants
    renderer.setRenderTarget(linearTarget);
    // Far city chunks start hidden by distance, and some casters only exist there, so show and un-cull everything once.
    const culled: THREE.Object3D[] = [], hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); }
      if (!o.visible) { o.visible = true; hidden.push(o); }
    });
    await renderer.compileAsync(scene, camera);
    // compileAsync never draws, so the shadow-depth variants (double-sided and instanced casters) and every program's
    // first-use driver work would land on the first gameplay frame that needs them. One all-on frame pays for them here.
    renderer.render(scene, camera);
    for (const o of culled) o.frustumCulled = true;
    for (const o of hidden) o.visible = false;
    // Some variants depend on where the shadow box and the LOD sit, so render one frame at every special place too.
    const home = camera.position.clone();
    for (const spot of landmarks.spots) {
      camera.position.set(spot.position.x + 40, spot.position.y + 30, spot.position.z + 40);
      camera.lookAt(spot.position);
      env.update(0, spot.position);
      city.update(camera);
      landmarks.update(0, camera, spot.position);
      renderer.render(scene, camera);
    }
    camera.position.copy(home);
    renderer.setRenderTarget(null);
    linearTarget.dispose();
    for (const b of birds) if (b !== macaw) b.object.removeFromParent();
  }

  const timer = new THREE.Timer();
  let fpsAccum = 0, fpsFrames = 0, slowSeconds = 0, programsChecked = false, programsAfterWarmUp = 0;

  function frame() {
    requestAnimationFrame(frame);
    timer.update();
    const dt = Math.min(timer.getDelta(), 1 / 20);
    const inp = input.state;

    if (phase === 'menu') {
      menuTime += dt;
      macaw.object.position.copy(player.position);
      macaw.object.quaternion.copy(player.quaternion);
      const key = env.lighting.sunDirection; // the menu bird turns its face to the sun or the moon
      const faceLight = Math.atan2(-key.x, -key.z);
      const turn = Math.atan2(Math.sin(faceLight - player.yaw), Math.cos(faceLight - player.yaw));
      if (Math.abs(turn) > 1e-3) player.placeOnGround(START[0], START[1], player.yaw + Math.sign(turn) * Math.min(Math.abs(turn), dt), world);
      macaw.update(dt, { mode: 'idle', effort: 0, bank: 0, pitch: 0, walkSpeed: 0, look: Math.sin(menuTime * 0.7) * 0.6 });
      const a = player.yaw + 0.5 + Math.sin(menuTime * 0.25) * 0.6; // sway around a three-quarter front view
      camera.position.set(player.position.x - Math.sin(a) * 1.3, player.position.y + 0.1, player.position.z - Math.cos(a) * 1.3);
      camera.lookAt(player.position.x, player.position.y + 0.1, player.position.z);
    } else if (phase === 'playing') {
      playTime += dt;
      prevPos.copy(player.position);
      player.landingAssist = nearestUnfoundSpot(90)?.position ?? null;
      const { anim, events } = player.update(dt, inp, world);
      macaw.object.position.copy(player.position);
      macaw.object.quaternion.copy(player.quaternion);
      macaw.update(dt, anim);
      macaw.object.updateMatrixWorld(true);
      macaw.wingTips[0].getWorldPosition(wingTips[0]);
      macaw.wingTips[1].getWorldPosition(wingTips[1]);
      velocity.subVectors(player.position, prevPos).divideScalar(dt || 1 / 60);
      flames.update(dt, player.flying ? player.boost : 0, wingTips, velocity, camera);

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

    env.update(dt, player.position); // first, so every consumer below reads this frame's lighting
    const L = env.lighting;
    city.applyLighting(L);
    landmarks.applyLighting(L);
    macaw.applyLighting(L, { menu: phase === 'menu' });
    const heroNight = THREE.MathUtils.smoothstep(L.night, 0.3, 0.9); // the sunset row (0.15) keeps today's exact 3 / 7 / warm
    const closeUp = phase === 'menu' ? heroNight : 0; // the menu sand is a metre under the light and must stay moonlit; in flight nothing is that close
    heroLight.intensity = THREE.MathUtils.lerp(3, 3.5, heroNight) * THREE.MathUtils.lerp(1, 0.15, closeUp);
    heroLight.distance = THREE.MathUtils.lerp(7, 10, heroNight);
    heroLight.color.lerpColors(HERO_WARM, HERO_MOON, heroNight);
    heroLight.position.copy(heroOffset).applyQuaternion(camera.quaternion).add(camera.position);
    rain.update(dt, L, camera);

    if (phase !== 'paused') {
      const dive = player.flying ? THREE.MathUtils.clamp((player.speed - 26) / 20, 0, 1) : 0;
      env.setSpeedEffect(Math.max(player.boost * 0.8, dive));
      audio.update({
        speed: player.flying ? player.speed : 0, altitude: player.altitude, distanceToCoast: distanceToCoast(player.position.x, player.position.z),
        flying: player.flying, effort: inp.flap ? 1 : 0.3, night: L.night, rain: L.rain, morning: L.morning,
      });
      landmarks.update(dt, camera, player.position);
    }
    city.update(camera);
    env.render(dt);
    input.endFrame();
    if (import.meta.env.DEV && playTime > 60 && !programsChecked) { // the no-recompile rule: the all-on warm-up must have met every program
      programsChecked = true;
      const n = renderer.info.programs?.length ?? 0;
      if (n !== programsAfterWarmUp) console.error(`shaders compiled during play: ${programsAfterWarmUp} after warm-up, ${n} after a minute`);
    }

    if (ui.settings.quality === 'auto' && phase === 'playing') {
      fpsAccum += dt; fpsFrames++;
      if (fpsAccum > 1) {
        const fps = fpsFrames / fpsAccum;
        slowSeconds = fps < 40 ? slowSeconds + 1 : 0;
        if (slowSeconds >= 4 && quality !== 'low') {
          quality = quality === 'high' ? 'medium' : 'low';
          setQualityEverywhere(quality);
          env.setSize(innerWidth, innerHeight);
          slowSeconds = 0;
        }
        fpsAccum = 0; fpsFrames = 0;
      }
    }
  }

  await warmUpShaders();
  ui.setLoading(1);
  frame();
  programsAfterWarmUp = renderer.info.programs?.length ?? 0; // the first frame also compiled the post chain
  if (import.meta.env.DEV) Object.assign(window, { game: { player, camera, landmarks, world, scene, renderer, city, env, rain, get programsAfterWarmUp() { return programsAfterWarmUp; }, setConditions: (c: Parameters<typeof env.setConditions>[0]) => env.setConditions(c), get phase() { return phase; }, get found() { return [...found]; }, get rings() { return ringsCollected; } } });

  const choice = await ui.showStart((c) => setSpecies(c.species));
  setSpecies(choice.species);
  playerName = choice.player;
  found = loadFound(playerName);
  for (const id of found) landmarks.setFound(id);
  await audio.unlock();
  applySettings();
  ui.showHud(true);
  player.placeOnGround(START[0], START[1], startYaw, world);
  phase = 'playing';
  chase.snap(player, world);
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('boot-loader');
  if (el) el.textContent = 'Oops, something went wrong: ' + (err?.message ?? err);
});
