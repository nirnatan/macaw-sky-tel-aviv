// Stand-alone harness for src/world/city.ts: real data, a stand-in environment per time of day (sky, key light, fog,
// env map, exposure) behind the game's bloom threshold and tone mapping, and sliders for the Lighting inputs.
// Window hooks for scripted screenshots: setPreset, setView, setQuality, setTime, setConditions, warmUp, programs, stats.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BloomEffect, BlendFunction, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { TIMES, type City, type Lighting, type Quality, type TimeOfDay } from '../src/contracts';
import { createCity } from '../src/world/city';
import { loadCityData } from '../src/world/data';

const PRESETS: Record<string, { pos: [number, number, number]; look: [number, number, number] }> = {
  overview: { pos: [-1900, 600, 1500], look: [-2300, 0, 600] },
  rothschild: { pos: [-1850, 55, 1250], look: [-2300, 10, 1680] },
  street: { pos: [-1740, 24, 1330], look: [-1718, 2, 1180] },
  roof: { pos: [1700, 28, -2990], look: [1730, 14, -2960] },
  facade: { pos: [1700, 9, -2974], look: [1732, 7, -2963] },
  school: { pos: [1760, 80, -2860], look: [1845, 12, -2940] },
  beach: { pos: [-2960, 45, 300], look: [-2990, 20, -400] },
  fringe: { pos: [4000, 350, 0], look: [8000, 40, 0] },
};

/** Rough stand-ins for the env module's preset rows; sunset follows today's game constants. */
interface Row {
  az: number; el: number; key: string; keyI: number; hemiSky: string; hemiGround: string; hemiI: number;
  zenith: string; horizon: string; glow: string; haze: string; hazeK: number; fog: number; exposure: number; night: number; morning: number;
}
const ROWS: Record<TimeOfDay, Row> = {
  sunrise: { az: 100, el: 6, key: '#ffb27a', keyI: 3.4, hemiSky: '#a9b8e0', hemiGround: '#6a5040', hemiI: 0.35, zenith: '#4f79b6', horizon: '#f2b9a2', glow: '#ffb070', haze: '#d8b2aa', hazeK: 0.75, fog: 0.00035, exposure: 1.0, night: 0.05, morning: 1 },
  noon: { az: 180, el: 58, key: '#fff3e2', keyI: 3.6, hemiSky: '#b9d2f0', hemiGround: '#7a6a55', hemiI: 0.55, zenith: '#2f66b5', horizon: '#c6daee', glow: '#fff1d6', haze: '#bccfe2', hazeK: 0.85, fog: 0.00022, exposure: 0.95, night: 0, morning: 0 },
  sunset: { az: 255, el: 8.5, key: '#ff8f45', keyI: 4.2, hemiSky: '#7f9bd0', hemiGround: '#5a4032', hemiI: 0.25, zenith: '#35609a', horizon: '#dea39c', glow: '#ff8a35', haze: '#ab99a4', hazeK: 0.72, fog: 0.0004, exposure: 1.0, night: 0.15, morning: 0 },
  night: { az: 135, el: 35, key: '#a9c2ff', keyI: 0.6, hemiSky: '#3b5292', hemiGround: '#1b1a24', hemiI: 0.5, zenith: '#06102a', horizon: '#1d2c52', glow: '#5d75b0', haze: '#1b2847', hazeK: 1, fog: 0.00035, exposure: 1.4, night: 1, morning: 0 },
};
const OVERCAST = new THREE.Color('#8592a6');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NoToneMapping; // tone mapping runs in the post chain, after bloom, as in the game
renderer.info.autoReset = false; // count the whole frame: shadow, scene and post passes
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.0004);
scene.environmentIntensity = 0.35;
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 30000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const sky = gradientSky();
scene.add(sky.mesh);
const envScene = new THREE.Scene();
envScene.add(sky.envMesh);
const cubeTarget = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
const cubeCamera = new THREE.CubeCamera(1, 100, cubeTarget);
const pmrem = new THREE.PMREMGenerator(renderer);
let envTarget: THREE.WebGLRenderTarget | null = null;

const key = new THREE.DirectionalLight(0xffffff, 1);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 50;
key.shadow.camera.far = 3000;
key.shadow.bias = -0.0005;
key.shadow.normalBias = 0.6;
const hemi = new THREE.HemisphereLight();
scene.add(key, key.target, hemi);

const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new EffectPass(camera,
  new BloomEffect({ blendFunction: BlendFunction.ADD, mipmapBlur: true, levels: 8, luminanceThreshold: 1.1, luminanceSmoothing: 0.4, intensity: 0.4, radius: 0.6 }),
  new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));
composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));

const lighting = {
  sunDirection: new THREE.Vector3(), sunColor: new THREE.Color(), hazeColor: new THREE.Color(),
  night: 0, morning: 0, rain: 0, wetness: 0, overcast: 0, rainbow: 0,
};
let time: TimeOfDay = 'sunset';

function applyEnvironment(): void {
  const r = ROWS[time], oc = lighting.overcast;
  const el = THREE.MathUtils.degToRad(r.el), az = THREE.MathUtils.degToRad(r.az);
  lighting.sunDirection.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
  lighting.sunColor.set(r.key).multiplyScalar(r.keyI * (1 - 0.65 * oc));
  const cloud = OVERCAST.clone().multiplyScalar(1 - 0.85 * r.night);
  lighting.hazeColor.set(r.haze).multiplyScalar(r.hazeK).lerp(cloud, 0.6 * oc);
  lighting.morning = r.morning;
  key.color.copy(lighting.sunColor);
  key.shadow.intensity = 1 - 0.8 * oc;
  hemi.color.set(r.hemiSky);
  hemi.groundColor.set(r.hemiGround);
  hemi.intensity = r.hemiI * (1 + 0.4 * oc);
  const gray = (hex: string) => new THREE.Color(hex).lerp(cloud, 0.6 * oc);
  sky.set(gray(r.zenith), gray(r.horizon), new THREE.Color(r.glow).multiplyScalar(1 - oc), lighting.hazeColor, lighting.sunDirection);
  const fog = scene.fog as THREE.FogExp2;
  fog.color.copy(lighting.hazeColor);
  fog.density = r.fog * (1 + 0.6 * oc);
  renderer.toneMappingExposure = r.exposure + 0.1 * oc;
  cubeCamera.update(renderer, envScene);
  envTarget = pmrem.fromCubemap(cubeTarget.texture, envTarget);
  scene.environment = envTarget.texture;
}

const data = await loadCityData();
const t0 = performance.now();
const city: City = createCity(data, { scene, quality: 'high' });
const buildMs = performance.now() - t0;
scene.add(city.group);
scene.add(seaPlane(data.sea));

const hud = document.getElementById('hud')!;
const panel = document.getElementById('presets')!;
let quality: Quality = 'high';
let lastSurface = '';
let applyMs = 0;
const fps = { frames: 0, last: performance.now(), value: 0 };
const gpu = gpuTimer(renderer.getContext() as WebGL2RenderingContext);

function setPreset(name: string): void {
  const p = PRESETS[name];
  if (!p) throw new Error(`unknown preset ${name}`);
  setView(p.pos, p.look);
}
function setView(pos: [number, number, number], look: [number, number, number]): void {
  camera.position.set(...pos);
  controls.target.set(...look);
  controls.update();
}
function setQuality(q: Quality): void { quality = q; city.setQuality(q); }

type Inputs = Partial<Pick<Lighting, 'night' | 'rain' | 'wetness' | 'overcast'>>;
const sliders = new Map<keyof Inputs, HTMLInputElement>();
/** Overrides the city's Lighting inputs; the stand-in sky follows overcast. */
function setConditions(c: Inputs): void {
  Object.assign(lighting, c);
  for (const [k, input] of sliders) input.value = String(lighting[k]);
  if (c.overcast !== undefined) applyEnvironment();
}
function setTime(t: TimeOfDay): void {
  time = t;
  setConditions({ night: ROWS[t].night });
  applyEnvironment();
}
/** The main.ts warm-up: everything on, then compile what is now visible. Programs are keyed on the output color
 *  space, so compile into the composer's buffer the scene really renders to, not the canvas. */
async function warmUp(): Promise<number> {
  city.applyLighting({ ...lighting, night: 1, rain: 1, wetness: 1, overcast: 1, rainbow: 1, morning: 1 });
  renderer.setRenderTarget(composer.inputBuffer);
  await renderer.compileAsync(scene, camera);
  renderer.setRenderTarget(null);
  city.applyLighting(lighting);
  return programs();
}
const programs = () => renderer.info.programs?.length ?? 0;
function stats() {
  const r = renderer.info.render;
  return { calls: r.calls, triangles: r.triangles, programs: programs(), fps: Math.round(fps.value), gpuMs: gpu.ms, applyMs, buildMs: Math.round(buildMs), quality, time };
}
const frames = (n = 2) => new Promise<void>((resolve) => { const step = () => (--n <= 0 ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step); });
Object.assign(window, { setPreset, setView, setQuality, setTime, setConditions, warmUp, programs, stats, frames, city, data, renderer, scene, camera, THREE });

const row = () => { const div = document.createElement('div'); div.className = 'row'; panel.appendChild(div); return div; };
const button = (parent: HTMLElement, label: string, onclick: () => void) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = onclick;
  parent.appendChild(b);
};
const times = row();
for (const t of TIMES) button(times, t, () => setTime(t));
for (const k of ['night', 'rain', 'wetness', 'overcast'] as const) {
  const label = document.createElement('label');
  label.textContent = k;
  const input = document.createElement('input');
  Object.assign(input, { type: 'range', min: '0', max: '1', step: '0.01', value: String(lighting[k]) });
  input.oninput = () => setConditions({ [k]: Number(input.value) });
  label.appendChild(input);
  panel.appendChild(label);
  sliders.set(k, input);
}
const views = row();
for (const name of Object.keys(PRESETS)) button(views, name, () => setPreset(name));
const tiers = row();
for (const q of ['low', 'medium', 'high'] as Quality[]) button(tiers, q, () => setQuality(q));
addEventListener('keydown', (e) => { if (e.key === '1') setQuality('low'); if (e.key === '2') setQuality('medium'); if (e.key === '3') setQuality('high'); });

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
renderer.domElement.addEventListener('click', (e) => {
  raycaster.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;
  const s = city.surfaceAt(hit.x, hit.z);
  lastSurface = `surfaceAt(${hit.x.toFixed(1)}, ${hit.z.toFixed(1)}) = ${s.kind} @ ${s.height.toFixed(2)}`;
  console.log(lastSurface);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

setPreset('overview');
setTime('sunset');
renderer.setAnimationLoop(() => {
  controls.update();
  const focus = controls.target;
  key.position.copy(focus).addScaledVector(lighting.sunDirection, 1200);
  key.target.position.copy(focus);
  const span = Math.max(150, camera.position.distanceTo(focus) * 0.9);
  const cam = key.shadow.camera;
  cam.left = cam.bottom = -span;
  cam.right = cam.top = span;
  cam.updateProjectionMatrix();
  sky.mesh.position.copy(camera.position);
  const a = performance.now();
  city.applyLighting(lighting);
  applyMs = applyMs * 0.95 + (performance.now() - a) * 0.05;
  city.update(camera);
  renderer.info.reset();
  gpu.begin();
  composer.render();
  gpu.end();
  fps.frames++;
  const now = performance.now();
  if (now - fps.last > 500) { fps.value = (fps.frames * 1000) / (now - fps.last); fps.frames = 0; fps.last = now; }
  const r = renderer.info.render, m = renderer.info.memory;
  hud.textContent = [
    `calls ${r.calls}  tris ${(r.triangles / 1e6).toFixed(2)}M  fps ${fps.value.toFixed(0)}  gpu ${gpu.ms ?? '?'} ms  quality ${quality}`,
    `programs ${programs()}  applyLighting ${(applyMs * 1000).toFixed(1)} us  geometries ${m.geometries}  textures ${m.textures}  build ${buildMs.toFixed(0)} ms`,
    `${time}  night ${lighting.night.toFixed(2)}  rain ${lighting.rain.toFixed(2)}  wet ${lighting.wetness.toFixed(2)}  overcast ${lighting.overcast.toFixed(2)}`,
    `cam ${camera.position.x.toFixed(0)}, ${camera.position.y.toFixed(0)}, ${camera.position.z.toFixed(0)}`,
    lastSurface || 'click: surfaceAt',
  ].join('\n');
});

/** Gradient dome with a sun glow; one copy is the background, the other feeds the env map. */
function gradientSky() {
  const uniforms = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = (projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0)).xyww; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uGlow, uGround, uSunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float mu = max(dot(d, uSunDir), 0.0);
        vec3 c = mix(uHorizon, uZenith, smoothstep(0.0, 0.6, sqrt(max(d.y, 0.0))));
        c += uGlow * (pow(mu, 8.0) * 0.5 + pow(mu, 400.0) * 6.0);
        c = mix(c, uGround, smoothstep(0.0, -0.08, d.y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const geometry = new THREE.SphereGeometry(1, 32, 16);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(20000);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  const envMesh = new THREE.Mesh(geometry, material);
  envMesh.scale.setScalar(50);
  return {
    mesh, envMesh,
    set(zenith: THREE.Color, horizon: THREE.Color, glow: THREE.Color, ground: THREE.Color, sunDir: THREE.Vector3) {
      uniforms.uZenith.value.copy(zenith);
      uniforms.uHorizon.value.copy(horizon);
      uniforms.uGlow.value.copy(glow);
      uniforms.uGround.value.copy(ground);
      uniforms.uSunDir.value.copy(sunDir);
    },
  };
}

/** Flat blue stand-in for the environment module's water, cut to the sea polygon so it never covers land. */
function seaPlane(sea: Float32Array): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < sea.length; i += 2) pts.push(new THREE.Vector2(sea[i], sea[i + 1]));
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => { pos[3 * i] = p.x; pos[3 * i + 2] = p.y; });
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(tris.flat());
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#2f6f8f', roughness: 0.15, metalness: 0.4, side: THREE.DoubleSide }));
  mesh.position.y = -0.05;
  return mesh;
}

/** GPU frame time through EXT_disjoint_timer_query_webgl2 when the browser exposes it; `ms` stays null otherwise. */
function gpuTimer(gl: WebGL2RenderingContext) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending: WebGLQuery[] = [];
  const api = { ms: null as number | null, begin() {}, end() {} };
  if (!ext) return api;
  api.begin = () => {
    while (pending.length) {
      const q = pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      pending.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
        api.ms = Math.round(((api.ms ?? ns / 1e6) * 0.9 + (ns / 1e6) * 0.1) * 100) / 100;
      }
      gl.deleteQuery(q);
    }
    if (pending.length < 4) { const q = gl.createQuery()!; gl.beginQuery(ext.TIME_ELAPSED_EXT, q); pending.push(q); api.end = () => gl.endQuery(ext.TIME_ELAPSED_EXT); } else api.end = () => {};
  };
  return api;
}
