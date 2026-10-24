// Stand-alone harness for src/fx/rain.ts: the real city and post chain under a stand-in time-of-day table (the env
// module owns the real one), a bird circling or standing still, and hooks on window.rain for scripted screenshots.
import * as THREE from 'three';
import type { Lighting, Quality, TimeOfDay } from '../src/contracts';
import { TIMES } from '../src/contracts';
import { createPost } from '../src/env/post';
import { TIERS } from '../src/env/quality';
import { createRain } from '../src/fx/rain';
import { project } from '../src/geo';
import { createMacaw } from '../src/macaw';
import { createCity } from '../src/world/city';
import { loadCityData } from '../src/world/data';

interface Preset {
  sunElevation: number; sunAzimuth: number; // degrees; azimuth clockwise from north
  sun: string; sunIntensity: number;
  zenith: string; horizon: string;
  haze: string; hazeScale: number;
  hemiSky: string; hemiGround: string; hemi: number;
  exposure: number; night: number; morning: number;
}
const PRESETS: Record<TimeOfDay, Preset> = {
  sunrise: { sunElevation: 10, sunAzimuth: 80, sun: '#ffb27a', sunIntensity: 3.4, zenith: '#5d86c4', horizon: '#f6c9a8', haze: '#d9b9b0', hazeScale: 0.75, hemiSky: '#a9bde0', hemiGround: '#6a5546', hemi: 0.7, exposure: 1, night: 0.05, morning: 1 },
  noon: { sunElevation: 60, sunAzimuth: 180, sun: '#fff3e0', sunIntensity: 3.6, zenith: '#3f7fd6', horizon: '#c4def5', haze: '#b8c8d8', hazeScale: 0.85, hemiSky: '#b9d2f2', hemiGround: '#7a6a58', hemi: 0.8, exposure: 0.95, night: 0, morning: 0 },
  sunset: { sunElevation: 8.5, sunAzimuth: 255, sun: '#ff8f45', sunIntensity: 4.2, zenith: '#35609a', horizon: '#ff9d5c', haze: '#ab99a4', hazeScale: 0.72, hemiSky: '#7f9bd0', hemiGround: '#5a4032', hemi: 0.6, exposure: 1, night: 0.15, morning: 0 },
  night: { sunElevation: 35, sunAzimuth: 140, sun: '#9bb4ff', sunIntensity: 0.55, zenith: '#0b1a3a', horizon: '#2a4170', haze: '#1c2a48', hazeScale: 0.6, hemiSky: '#4a62a0', hemiGround: '#1a1a26', hemi: 0.45, exposure: 1.4, night: 1, morning: 0 },
};

interface Row { sunDirection: THREE.Vector3; sun: THREE.Color; zenith: THREE.Color; horizon: THREE.Color; haze: THREE.Color; hemiSky: THREE.Color; hemiGround: THREE.Color; hemi: number; exposure: number; night: number; morning: number }
function row(p: Preset): Row {
  const e = THREE.MathUtils.degToRad(p.sunElevation), a = THREE.MathUtils.degToRad(p.sunAzimuth);
  return {
    sunDirection: new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)),
    sun: new THREE.Color(p.sun).multiplyScalar(p.sunIntensity), zenith: new THREE.Color(p.zenith), horizon: new THREE.Color(p.horizon),
    haze: new THREE.Color(p.haze).multiplyScalar(p.hazeScale), hemiSky: new THREE.Color(p.hemiSky), hemiGround: new THREE.Color(p.hemiGround),
    hemi: p.hemi, exposure: p.exposure, night: p.night, morning: p.morning,
  };
}
const ROWS = Object.fromEntries(TIMES.map((t) => [t, row(PRESETS[t])])) as Record<TimeOfDay, Row>;

const params = new URLSearchParams(location.search);
let quality = (params.get('q') as Quality | null) ?? 'high';
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // the post chain tone maps
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 30000);
const fog = new THREE.FogExp2(0x000000, 0.0012);
scene.fog = fog;

const skyUniforms = { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
  vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 uZenith; uniform vec3 uHorizon; varying vec3 vDir; void main() { gl_FragColor = vec4(mix(uHorizon, uZenith, pow(clamp(vDir.y, 0.0, 1.0), 0.45)), 1.0); }',
}));
sky.renderOrder = -1;
scene.add(sky);

const key = new THREE.DirectionalLight(0xffffff, 1);
key.castShadow = true;
Object.assign(key.shadow.camera, { left: -160, right: 160, top: 160, bottom: -160, near: 1, far: 1500 });
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.3;
const hemi = new THREE.HemisphereLight();
scene.add(key, key.target, hemi);

const data = await loadCityData();
const city = createCity(data, { scene, quality });
scene.add(city.group, seaPlane(data.sea));

const macaw = createMacaw('blueGold');
macaw.object.rotation.order = 'YXZ';
scene.add(macaw.object);

const rain = createRain({ quality, surfaceAt: (x, z, below) => city.surfaceAt(x, z, below) });
scene.add(rain.object);
let rainDraws = 0;
const gl = renderer.getContext() as WebGL2RenderingContext;
const timerQuery = gl.getExtension('EXT_disjoint_timer_query_webgl2');
for (const mesh of rain.object.children) mesh.onAfterRender = () => { rainDraws++; };

function buildPost() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, TIERS[quality].maxPixelRatio));
  const built = createPost(renderer, scene, camera, TIERS[quality]);
  built.composer.setSize(innerWidth, innerHeight);
  return built;
}
let post = buildPost();

// ---------- Conditions and the stand-in Lighting ----------
const lighting = {
  sunDirection: new THREE.Vector3(), sunColor: new THREE.Color(), hazeColor: new THREE.Color(),
  night: 0, morning: 0, rain: 0, wetness: 0, overcast: 0, rainbow: 0,
};
const L: Lighting = lighting;
const state = { time: 'sunset' as TimeOfDay, raining: params.get('rain') !== '0', blend: 1, from: cloneRow(ROWS.sunset), rainLevel: 0 };
const blended = cloneRow(ROWS.sunset);
const overrides: Partial<Record<'night' | 'rain' | 'overcast', number>> = {};
function cloneRow(r: Row): Row {
  return { ...r, sunDirection: r.sunDirection.clone(), sun: r.sun.clone(), zenith: r.zenith.clone(), horizon: r.horizon.clone(), haze: r.haze.clone(), hemiSky: r.hemiSky.clone(), hemiGround: r.hemiGround.clone() };
}
function mixRow(out: Row, a: Row, b: Row, t: number) {
  out.sunDirection.lerpVectors(a.sunDirection, b.sunDirection, t).normalize();
  for (const k of ['sun', 'zenith', 'horizon', 'haze', 'hemiSky', 'hemiGround'] as const) out[k].lerpColors(a[k], b[k], t);
  for (const k of ['hemi', 'exposure', 'night', 'morning'] as const) out[k] = THREE.MathUtils.lerp(a[k], b[k], t);
}
function setConditions(time: TimeOfDay, raining: boolean, instant = false) {
  if (time !== state.time) { state.from = cloneRow(blended); state.blend = instant ? 1 : 0; state.time = time; }
  state.raining = raining;
  if (instant) { state.blend = 1; state.rainLevel = raining ? 1 : 0; }
  renderPanel();
}

const gray = new THREE.Color();
function overcastColor(c: THREE.Color, amount: number, brightness: number) {
  const luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  gray.setRGB(luma * 0.92, luma * 0.97, luma * 1.08).multiplyScalar(brightness);
  c.lerp(gray, amount);
}
function updateConditions(dt: number) {
  state.blend = Math.min(1, state.blend + dt / 3);
  const t = state.blend * state.blend * (3 - 2 * state.blend);
  mixRow(blended, state.from, ROWS[state.time], t);
  state.rainLevel = THREE.MathUtils.clamp(state.rainLevel + (state.raining ? dt : -dt) / 5, 0, 1);
  lighting.rain = overrides.rain ?? state.rainLevel;
  lighting.overcast = overrides.overcast ?? Math.min(1, lighting.rain * 1.4);
  lighting.night = overrides.night ?? blended.night;
  lighting.morning = blended.morning;
  lighting.wetness = lighting.rain;
  const oc = lighting.overcast;
  lighting.sunDirection.copy(blended.sunDirection);
  lighting.sunColor.copy(blended.sun).multiplyScalar(1 - 0.75 * oc);
  lighting.hazeColor.copy(blended.haze);
  overcastColor(lighting.hazeColor, oc * 0.8, 1);

  skyUniforms.uZenith.value.copy(blended.zenith);
  skyUniforms.uHorizon.value.copy(blended.horizon);
  overcastColor(skyUniforms.uZenith.value, oc * 0.85, 0.75);
  overcastColor(skyUniforms.uHorizon.value, oc * 0.85, 0.85);
  fog.color.copy(lighting.hazeColor);
  fog.density = THREE.MathUtils.lerp(0.0012, 0.0032, oc);
  key.color.copy(lighting.sunColor);
  key.intensity = 1;
  key.shadow.intensity = 1 - 0.7 * oc;
  hemi.color.copy(blended.hemiSky);
  hemi.groundColor.copy(blended.hemiGround);
  hemi.intensity = blended.hemi * (1 + 0.3 * oc);
  renderer.toneMappingExposure = blended.exposure;
}

// ---------- Bird and camera ----------
const [beachX, beachZ] = project(32.0835, 34.7674);
const VIEWS = {
  chase: { center: [1800, -2900], radius: 120, altitude: 30, camera: null },
  low: { center: [1800, -2900], radius: 90, altitude: 18, camera: null },
  high: { center: [1800, -2900], radius: 160, altitude: 65, camera: null },
  street: { center: [-2300, 1500], radius: 0, altitude: 1.6, camera: { pos: [-2290, 1.7, 1490], look: [-2300, 1.4, 1530] } },
  roof: { center: [1730, -2960], radius: 0, altitude: 0, camera: { pos: [1700, 28, -2990], look: [1730, 14, -2960] } },
  beach: { center: [beachX, beachZ], radius: 0, altitude: 2, camera: { pos: [beachX + 6, 3.2, beachZ], look: [beachX - 60, 0, beachZ] } },
} as const;
type View = keyof typeof VIEWS;
let view: View = (params.get('view') as View | null) ?? 'chase';
const flight = { angle: 0, speed: 30, turn: 1 };
const bird = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const chaseOffset = new THREE.Vector3();
let yaw = 0;

function placeBird(dt: number) {
  const v = VIEWS[view];
  const ground = city.surfaceAt(v.center[0], v.center[1]).height;
  if (v.radius > 0) {
    flight.angle += (flight.speed / v.radius) * dt * flight.turn;
    bird.set(v.center[0] + Math.cos(flight.angle) * v.radius, ground + v.altitude, v.center[1] + Math.sin(flight.angle) * v.radius);
    const tx = -Math.sin(flight.angle) * flight.turn, tz = Math.cos(flight.angle) * flight.turn;
    yaw = Math.atan2(-tx, -tz);
    chaseOffset.set(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(4.5).setY(1.3);
    camera.position.copy(bird).add(chaseOffset);
    lookAt.set(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(2).add(bird);
    camera.lookAt(lookAt);
    camera.rotateZ(flight.turn * Math.min(flight.speed / 44, 1) * 0.15);
    const fov = 60 + Math.min(flight.speed / 44, 1) * 10;
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  } else if (v.camera) {
    camera.position.fromArray(v.camera.pos);
    lookAt.fromArray(v.camera.look);
    camera.lookAt(lookAt);
    bird.copy(camera.position).lerp(lookAt, 4 / camera.position.distanceTo(lookAt));
    yaw = Math.atan2(camera.position.x - lookAt.x, camera.position.z - lookAt.z) + Math.PI;
    if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
  }
  macaw.object.position.copy(bird);
  macaw.object.rotation.set(0, yaw, v.radius > 0 ? -flight.turn * 0.35 : 0);
  macaw.update(dt, { mode: v.radius > 0 ? (flight.speed > 35 ? 'dive' : 'glide') : 'hover', effort: 0.4, bank: v.radius > 0 ? flight.turn * 0.35 : 0, pitch: 0, walkSpeed: 0, look: 0 });
  key.position.copy(bird).addScaledVector(L.sunDirection, 600);
  key.target.position.copy(bird);
}

// ---------- Panel ----------
const panelEl = document.getElementById('panel')!;
const statsEl = document.getElementById('stats')!;
function button(label: string, on: boolean, click: () => void) {
  const b = document.createElement('button');
  b.textContent = label;
  b.classList.toggle('on', on);
  b.onclick = click;
  return b;
}
function slider(name: 'night' | 'rain' | 'overcast') {
  const label = document.createElement('label');
  const input = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '1', step: '0.01', value: String(overrides[name] ?? L[name]) });
  input.oninput = () => { overrides[name] = Number(input.value); };
  label.append(`${name}${overrides[name] === undefined ? '' : '*'}`, input);
  return label;
}
function renderPanel() {
  panelEl.replaceChildren(
    ...TIMES.map((t) => button(t, t === state.time, () => setConditions(t, state.raining))),
    button(state.raining ? 'rain: on' : 'rain: off', state.raining, () => setConditions(state.time, !state.raining)),
    slider('night'), slider('rain'), slider('overcast'),
    button('auto', false, () => { for (const k of Object.keys(overrides) as (keyof typeof overrides)[]) delete overrides[k]; renderPanel(); }),
    ...[0, 15, 30, 44].map((s) => button(`${s} m/s`, s === flight.speed, () => { flight.speed = s; renderPanel(); })),
    ...(Object.keys(VIEWS) as View[]).map((v) => button(v, v === view, () => { view = v; renderPanel(); })),
    ...(['low', 'medium', 'high'] as Quality[]).map((q) => button(q, q === quality, () => setQuality(q))),
  );
}
function setQuality(q: Quality) {
  quality = q;
  rain.setQuality(q);
  city.setQuality(q);
  post.composer.dispose();
  post = buildPost();
  renderPanel();
}
addEventListener('keydown', (e) => {
  if (e.code === 'KeyT') setConditions(TIMES[(TIMES.indexOf(state.time) + 1) % TIMES.length], state.raining);
  if (e.code === 'KeyR') setConditions(state.time, !state.raining);
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  post.composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- Warm-up and loop ----------
// The post chain draws the scene into a linear render target, and output color space is part of the program key, so the
// warm-up compiles with any linear target bound. ?warm=screen compiles against the canvas, as a bare compileAsync does,
// and the first rain still compiles; ?warm=0 skips the warm-up.
const ALL_ON: Lighting = { sunDirection: new THREE.Vector3(0, 1, 0), sunColor: new THREE.Color(1, 1, 1), hazeColor: new THREE.Color(0.5, 0.5, 0.5), night: 1, morning: 1, rain: 1, wetness: 1, overcast: 1, rainbow: 1 };
const warm = params.get('warm') ?? 'target';
if (warm !== '0') {
  placeBird(0);
  rain.update(0, ALL_ON, camera);
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  if (warm === 'target') renderer.setRenderTarget(target);
  await renderer.compileAsync(scene, camera);
  renderer.setRenderTarget(null);
  target.dispose();
}
setConditions((params.get('time') as TimeOfDay | null) ?? 'sunset', state.raining, true);

const stats = { fps: 0, updateMicros: 0, rainDraws: 0, calls: 0, programs: 0, streaks: 0 };
const timer = new THREE.Timer();
let frames = 0, frameTime = 0, updateTime = 0;
function step(dt: number) {
  updateConditions(dt);
  placeBird(dt);
  city.update(camera);
  const t0 = performance.now();
  rain.update(dt, L, camera);
  updateTime += performance.now() - t0;
  renderer.info.reset();
  rainDraws = 0;
  post.composer.render(dt);
}
function frame(now: number) {
  requestAnimationFrame(frame);
  timer.update(now);
  const dt = THREE.MathUtils.clamp(timer.getDelta(), 0, 1 / 20); // the first rAF timestamp can precede the timer start
  step(dt);
  frames++;
  frameTime += dt;
  if (frameTime > 0.5) {
    Object.assign(stats, {
      fps: frames / frameTime, updateMicros: (updateTime / frames) * 1000, rainDraws, calls: renderer.info.render.calls,
      programs: renderer.info.programs?.length ?? 0, streaks: (rain.object.children[0] as THREE.Mesh<THREE.InstancedBufferGeometry>).geometry.instanceCount,
    });
    statsEl.textContent = `${stats.fps.toFixed(0)} fps · ${stats.calls} calls (rain ${stats.rainDraws}) · programs ${stats.programs} · rain.update ${stats.updateMicros.toFixed(1)} µs\n`
      + `${state.time} · rain ${L.rain.toFixed(2)} · night ${L.night.toFixed(2)} · overcast ${L.overcast.toFixed(2)} · streaks ${stats.streaks} · ${quality} · ${view} ${flight.speed} m/s`;
    frames = 0; frameTime = 0; updateTime = 0;
  }
}
renderPanel();
requestAnimationFrame(frame);

const settle = (seconds: number) => new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
Object.assign(window, {
  rain: {
    setConditions(time: TimeOfDay, raining: boolean, instant = true) { setConditions(time, raining, instant); },
    override(o: typeof overrides) { Object.assign(overrides, o); renderPanel(); },
    setSpeed(s: number) { flight.speed = s; renderPanel(); },
    setTurn(t: number) { flight.turn = t; },
    setView(v: View) { view = v; renderPanel(); },
    setQuality,
    stats: () => ({ ...stats, programs: renderer.info.programs?.length ?? 0 }),
    programList: () => (renderer.info.programs ?? []).map((p) => `${p.name}#${p.id}`),
    tint: () => ((rain.object.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material.uniforms.uColor.value as THREE.Color).toArray(),
    /** Flips through every condition `rounds` times, rendering in between, and reports the program count before and after. */
    async cycle(rounds = 5) {
      const before = renderer.info.programs?.length ?? 0;
      const seen: number[] = [];
      for (let i = 0; i < rounds; i++) {
        for (const t of TIMES) for (const r of [true, false]) {
          setConditions(t, r, true);
          await settle(0.12);
          seen.push(renderer.info.programs?.length ?? 0);
        }
      }
      return { before, after: renderer.info.programs?.length ?? 0, min: Math.min(...seen), max: Math.max(...seen), switches: seen.length };
    },
    /**
     * Upper bound of the rain's GPU cost: the rain alone, with no depth to reject hidden fragments, drawn `repeats` times
     * into a drawing-buffer-sized target under one timer query, minus the same block with the rain hidden.
     */
    async gpuFill(repeats = 40) {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
      const solo = new THREE.Scene();
      const time = async (visible: boolean) => {
        rain.object.visible = visible;
        const query = gl.createQuery()!;
        renderer.setRenderTarget(target);
        gl.beginQuery(timerQuery!.TIME_ELAPSED_EXT, query);
        for (let i = 0; i < repeats; i++) { renderer.clear(); renderer.render(solo, camera); }
        gl.endQuery(timerQuery!.TIME_ELAPSED_EXT);
        renderer.setRenderTarget(null);
        while (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) await settle(0.02);
        const ms = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6 / repeats;
        gl.deleteQuery(query);
        return ms;
      };
      solo.add(rain.object);
      const runs = [];
      for (let i = 0; i < 5; i++) runs.push((await time(true)) - (await time(false)));
      scene.add(rain.object);
      target.dispose();
      return { quality, pixels: size.x * size.y, streaks: (rain.object.children[0] as THREE.Mesh<THREE.InstancedBufferGeometry>).geometry.instanceCount, msPerFrame: runs.sort((x, y) => x - y)[2] };
    },
    bench(updates = 5000) { // CPU cost of rain.update alone, with the splash upload ranges cleared the way a render would
      const splashBuffer = ((rain.object.children[1] as THREE.Mesh).geometry.getAttribute('aSplash') as THREE.InterleavedBufferAttribute).data;
      const t0 = performance.now();
      for (let i = 0; i < updates; i++) {
        camera.position.x += 0.5;
        rain.update(1 / 60, L, camera);
        splashBuffer.clearUpdateRanges();
      }
      return { quality, microsecondsPerUpdate: ((performance.now() - t0) * 1000) / updates };
    },
  },
});

/** Flat stand-in for the environment module's water, cut to the sea polygon so it never covers land. */
function seaPlane(sea: Float32Array): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < sea.length; i += 2) pts.push(new THREE.Vector2(sea[i], sea[i + 1]));
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => { pos[3 * i] = p.x; pos[3 * i + 2] = p.y; });
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(THREE.ShapeUtils.triangulateShape(pts, []).flat());
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#2f6f8f', roughness: 0.2, metalness: 0.3, side: THREE.DoubleSide }));
  mesh.position.y = -0.05;
  mesh.receiveShadow = true;
  return mesh;
}
