import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BlendFunction, BloomEffect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { loadCityData, type Building, type CityData } from '../src/world/data';
import { createLandmarks } from '../src/game/landmarks';
import type { Lighting, TargetId, TimeOfDay } from '../src/contracts';
import { project } from '../src/geo';

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the post chain, after bloom, as in the game
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
const sky = new THREE.Color();
scene.background = sky;
const fog = new THREE.FogExp2('#f2b98a', 0.0004); // the game's density; the lanterns fade by it
scene.fog = fog;
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 40000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const hemi = new THREE.HemisphereLight('#ffe6c4', '#8a6a52', 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffc98a', 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 1500 });
scene.add(sun, sun.target);

// The game's bloom (src/env/post.ts): a fixed 1.1 threshold before tone mapping, so night glows target raw radiance.
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
composer.addPass(new RenderPass(scene, camera));
const bloom = new BloomEffect({ blendFunction: BlendFunction.ADD, mipmapBlur: true, luminanceThreshold: 1.1, luminanceSmoothing: 0.4, intensity: 0.4, radius: 0.6 });
if (params.get('bloom') === '0') bloom.blendMode.blendFunction = BlendFunction.SKIP;
composer.addPass(new EffectPass(camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));

function extrudeNear(buildings: Building[], centers: THREE.Vector2[], radius: number): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  const palette: Record<string, string> = { target: '#ffab3d', tower: '#b9c6d3', public: '#f1d7b0', landmark: '#e8c8a0' };
  for (const b of buildings) {
    const ring = b.rings[0];
    if (!centers.some((c) => Math.hypot(ring[0] - c.x, ring[1] - c.y) < radius) || b.height > 400) continue;
    const shape = new THREE.Shape(Array.from({ length: ring.length / 2 }, (_, i) => new THREE.Vector2(ring[i * 2], ring[i * 2 + 1])));
    const g = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, b.height, 0);
    const c = new THREE.Color(palette[b.kind] ?? '#eadfce').offsetHSL(0, 0, (b.seed - 0.5) * 0.08);
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(g.index ? g.toNonIndexed() : g);
  }
  const merged = new THREE.BufferGeometry();
  const total = geos.reduce((n, g) => n + g.attributes.position.count, 0);
  for (const name of ['position', 'normal', 'color']) {
    const arr = new Float32Array(total * 3);
    let o = 0;
    for (const g of geos) { arr.set(g.attributes[name].array as Float32Array, o); o += g.attributes[name].array.length; }
    merged.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function roadsNear(data: CityData, centers: THREE.Vector2[], radius: number): THREE.LineSegments {
  const pts: number[] = [];
  for (const r of data.roads) {
    const p = r.pts;
    if (!centers.some((c) => Math.hypot(p[0] - c.x, p[1] - c.y) < radius)) continue;
    for (let i = 0; i + 3 < p.length; i += 2) pts.push(p[i], 0.15, p[i + 1], p[i + 2], 0.15, p[i + 3]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#7a6f66' }));
}

function seaMesh(data: CityData): THREE.Mesh {
  const s = data.sea;
  const shape = new THREE.Shape(Array.from({ length: s.length / 2 }, (_, i) => new THREE.Vector2(s[i * 2], -s[i * 2 + 1])));
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3d8fc4', roughness: 0.7 }));
  mesh.position.y = 0.05;
  mesh.receiveShadow = true;
  return mesh;
}

const data = await loadCityData();
const school = new THREE.Vector2(data.targets.school.x, data.targets.school.z);
const gan = new THREE.Vector2(data.targets.gan.x, data.targets.gan.z);
const [azX, azZ] = project(32.0742, 34.792);
const [gordonX, gordonZ] = project(32.0835, 34.7685);
const contextCenters = [school, gan, new THREE.Vector2(azX, azZ), new THREE.Vector2(gordonX, gordonZ)];

const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#d9c4a3', roughness: 1 }));
ground.receiveShadow = true;
const context = new THREE.Group();
context.add(ground, seaMesh(data), extrudeNear(data.buildings, contextCenters, 420), roadsNear(data, contextCenters, 420));
scene.add(context);

// A stand-in for the environment module: enough sky, haze and key light to judge the landmarks under each condition.
const TIME_ROWS: Record<TimeOfDay, { night: number; morning: number; sky: string; haze: string; sun: string; sunI: number; elev: number; azim: number; exposure: number }> = {
  sunrise: { night: 0.05, morning: 1, sky: '#f3c3a6', haze: '#e9b9a4', sun: '#ffb27a', sunI: 2.3, elev: 9, azim: 95, exposure: 1.05 },
  noon: { night: 0, morning: 0, sky: '#9cc9ee', haze: '#c4d6e6', sun: '#fff2dc', sunI: 3.0, elev: 58, azim: 180, exposure: 1.0 },
  sunset: { night: 0.15, morning: 0, sky: '#f4bf86', haze: '#f2b98a', sun: '#ffc98a', sunI: 2.6, elev: 8.5, azim: 255, exposure: 1.05 },
  night: { night: 1, morning: 0, sky: '#14214d', haze: '#1d2b55', sun: '#9fb4ff', sunI: 0.45, elev: 40, azim: 140, exposure: 1.4 },
};
const RAIN_SKY = { day: new THREE.Color('#9ba7b6'), night: new THREE.Color('#1b2333') };

const lighting = {
  sunDirection: new THREE.Vector3(), sunColor: new THREE.Color(), hazeColor: new THREE.Color(),
  night: 0.15, morning: 0, rain: 0, wetness: 0, overcast: 0, rainbow: 0,
};
const L: Lighting = lighting;
let timeOfDay: TimeOfDay = (params.get('time') as TimeOfDay) ?? 'sunset';
const ALL_ON: Lighting = { sunDirection: new THREE.Vector3(0, 1, 0), sunColor: new THREE.Color(1, 1, 1), hazeColor: new THREE.Color(0.5, 0.5, 0.5), night: 1, morning: 1, rain: 1, wetness: 1, overcast: 1, rainbow: 1 };

function applyEnv() {
  const row = TIME_ROWS[timeOfDay];
  const e = THREE.MathUtils.degToRad(row.elev), a = THREE.MathUtils.degToRad(row.azim);
  lighting.sunDirection.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
  const gray = Math.max(lighting.overcast, lighting.rain);
  const rainSky = RAIN_SKY.day.clone().lerp(RAIN_SKY.night, lighting.night);
  sky.set(row.sky).lerp(rainSky, gray * 0.85);
  lighting.hazeColor.set(row.haze).lerp(rainSky, gray * 0.85);
  fog.color.copy(lighting.hazeColor);
  lighting.sunColor.set(row.sun).multiplyScalar(row.sunI * (1 - 0.75 * gray));
  sun.color.set(row.sun);
  sun.intensity = row.sunI * (1 - 0.75 * gray);
  sun.shadow.intensity = 1 - 0.8 * gray;
  hemi.color.set(row.night > 0.5 ? '#6f86c9' : '#ffe6c4').lerp(new THREE.Color('#c9d2de'), gray * 0.6);
  hemi.groundColor.set(row.night > 0.5 ? '#26304d' : '#8a6a52');
  hemi.intensity = THREE.MathUtils.lerp(1.1, 0.9, lighting.night) * (1 - 0.15 * gray);
  renderer.toneMappingExposure = row.exposure;
  placeSun();
}

function setTime(t: TimeOfDay) {
  timeOfDay = t;
  lighting.night = TIME_ROWS[t].night;
  lighting.morning = TIME_ROWS[t].morning;
  applyEnv();
  syncSliders();
}

/** Partial Lighting scalars, as the sliders set them. */
function setLighting(p: Partial<Pick<Lighting, 'night' | 'rain' | 'wetness' | 'overcast' | 'rainbow'>> & { time?: TimeOfDay }) {
  if (p.time) setTime(p.time);
  const { time: _, ...scalars } = p;
  Object.assign(lighting, scalars);
  applyEnv();
  syncSliders();
}

const quality = (params.get('q') as 'low' | 'medium' | 'high') ?? 'high';
const landmarks = createLandmarks(data, { scene, quality });
const [schoolSpot, ganSpot] = landmarks.spots;
const ganGroup = landmarks.group.getObjectByName('gan')!;

const bird = new THREE.Vector3();
type View = { pos: THREE.Vector3; look: THREE.Vector3; bird?: THREE.Vector3 }; // the harness bird sits at `look` unless a view parks it
let parkedBird: THREE.Vector3 | null = null;
const ring = (i: number) => {
  const p = landmarks.rings[i].position;
  const next = landmarks.rings[Math.min(i + 1, landmarks.rings.length - 1)].position;
  const dir = next.clone().sub(p).setY(0).normalize();
  return { pos: p.clone().addScaledVector(dir, -30).add(new THREE.Vector3(0, 4, 0)), look: p.clone().addScaledVector(dir, 60) };
};
const mid = schoolSpot.position.clone().lerp(ganSpot.position, 0.5);
const views: Record<string, () => View> = {
  gan: () => ({ pos: ganGroup.localToWorld(new THREE.Vector3(16, 13, 26)), look: ganGroup.localToWorld(new THREE.Vector3(0, 1.5, 0)) }),
  ganTop: () => ({ pos: ganSpot.position.clone().add(new THREE.Vector3(6, 45, 18)), look: ganSpot.position.clone() }),
  school: () => ({ pos: schoolSpot.position.clone().add(new THREE.Vector3(38, 30, 36)), look: schoolSpot.position.clone() }),
  near: () => ({ pos: mid.clone().add(new THREE.Vector3(-210, 110, 200)), look: mid.clone().setY(30) }),
  far: () => ({ pos: mid.clone().add(new THREE.Vector3(-1500, 220, 1300)), look: mid.clone().setY(60) }),
  far3k: () => ({ pos: mid.clone().add(new THREE.Vector3(-2200, 200, 2100)), look: mid.clone().setY(80) }),
  start: () => ({ pos: new THREE.Vector3(gordonX, 40, gordonZ), look: landmarks.rings[0].position.clone() }),
  ring: () => ring(Number(params.get('ring') ?? 1)),
  azrieli: () => ({ pos: new THREE.Vector3(azX - 420, 230, azZ + 380), look: new THREE.Vector3(azX, 90, azZ) }),
  sea: () => {
    const boats: THREE.Object3D[] = [];
    landmarks.group.traverse((o) => { if (o.name === 'boat') boats.push(o); });
    const look = boats[1].position.clone();
    return { pos: look.clone().add(new THREE.Vector3(70, 16, -60)), look };
  },
  balloon: () => {
    const look = landmarks.group.getObjectByName('balloon')!.position.clone().add(new THREE.Vector3(0, 12, 0));
    return { pos: look.clone().add(new THREE.Vector3(60, -15, 60)), look };
  },
  gulls: () => {
    const flock = landmarks.group.getObjectByName('gulls') as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    flock.getMatrixAt(0, m);
    const look = new THREE.Vector3().setFromMatrixPosition(m);
    return { pos: look.clone().add(new THREE.Vector3(12, 5, 12)), look, bird: look.clone().add(new THREE.Vector3(0, 60, 0)) };
  },
};

function placeSun() {
  sun.target.position.copy(controls.target).setY(0);
  sun.position.copy(sun.target.position).addScaledVector(lighting.sunDirection, 600);
}
function setView(name: string) {
  const v = (views[name] ?? views.near)();
  camera.position.copy(v.pos);
  controls.target.copy(v.look);
  parkedBird = v.bird ?? null;
  controls.update();
  placeSun();
}
const buttons = document.getElementById('views')!;
for (const name of Object.keys(views)) {
  const b = Object.assign(document.createElement('button'), { textContent: name, onclick: () => setView(name) });
  buttons.append(b);
}
for (const id of ['school', 'gan'] as TargetId[]) {
  buttons.append(Object.assign(document.createElement('button'), { textContent: `found ${id}`, onclick: () => landmarks.setFound(id) }));
  buttons.append(Object.assign(document.createElement('button'), { textContent: `burst ${id}`, onclick: () => landmarks.burst(id) }));
}
const panel = document.getElementById('conditions')!;
for (const t of Object.keys(TIME_ROWS) as TimeOfDay[]) panel.append(Object.assign(document.createElement('button'), { textContent: t, onclick: () => setTime(t) }));
const sliders = (['night', 'rain', 'wetness', 'overcast', 'rainbow'] as const).map((key) => {
  const input = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '1', step: '0.01' });
  input.oninput = () => setLighting({ [key]: Number(input.value) });
  const label = Object.assign(document.createElement('label'), { textContent: key });
  label.append(input);
  panel.append(label);
  return { key, input };
});
function syncSliders() {
  for (const { key, input } of sliders) input.value = String(lighting[key]);
}
panel.append(Object.assign(document.createElement('button'), { textContent: 'rain on/off', onclick: () => {
  const on = lighting.rain < 0.5 ? 1 : 0;
  setLighting({ rain: on, wetness: on, overcast: on });
} }));

const startTime = params.get('time') as TimeOfDay | null;
setTime(startTime ?? 'sunset');
if (params.has('rain')) setLighting({ rain: 1, wetness: 1, overcast: 1 });
landmarks.applyLighting(L);
landmarks.update(0, camera, bird);
setView(params.get('view') ?? 'near');

/** Renders one frame through the whole chain, applying `l` first like main does. */
function frame(dt: number, l: Lighting = L) {
  controls.update();
  bird.copy(parkedBird ?? controls.target);
  landmarks.applyLighting(l);
  landmarks.update(dt, camera, bird);
  composer.render(dt);
}

/**
 * The no-recompile check: one all-on warm-up, then many random condition changes rendered from every view.
 * Returns the program counts; they must all equal the count after warm-up.
 */
async function checkRecompile(switches = 40) {
  landmarks.applyLighting(ALL_ON);
  await renderer.compileAsync(scene, camera);
  for (const name of Object.keys(views)) { setView(name); frame(0.016, ALL_ON); }
  const afterWarmup = renderer.info.programs!.length;
  const counts: number[] = [];
  const times = Object.keys(TIME_ROWS) as TimeOfDay[];
  for (let i = 0; i < switches; i++) {
    setLighting({ time: times[i % 4], rain: Math.random() < 0.5 ? 0 : Math.random(), wetness: Math.random(), overcast: Math.random(), rainbow: Math.random() });
    if (i % 3 === 0) setLighting({ night: Math.random() });
    setView(Object.keys(views)[i % Object.keys(views).length]);
    for (let f = 0; f < 3; f++) frame(0.05);
    counts.push(renderer.info.programs!.length);
  }
  return { afterWarmup, counts, unchanged: counts.every((c) => c === afterWarmup) };
}

/** Draw calls for the landmarks alone, with the placeholder city hidden and no post-processing. */
function landmarkCalls(): number {
  context.visible = false;
  renderer.info.reset();
  renderer.autoClear = true;
  renderer.render(scene, camera);
  const calls = renderer.info.render.calls;
  context.visible = true;
  return calls;
}
Object.assign(window, { landmarks, data, camera, controls, setView, landmarkCalls, THREE, renderer, scene, setTime, setLighting, lighting, checkRecompile, frame, programs: () => renderer.info.programs!.length });

const stats = document.getElementById('stats')!;
const timer = new THREE.Timer();
let frames = 0, acc = 0;
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  frame(dt);
  frames++;
  acc += dt;
  if (acc > 0.5) {
    stats.textContent = `${Math.round(frames / acc)} fps · cam ${camera.position.toArray().map(Math.round).join(', ')}`;
    frames = 0;
    acc = 0;
  }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
