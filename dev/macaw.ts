import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Lighting, MacawAnimInput, MacawMode, Species } from '../src/contracts';
import { createMacaw } from '../src/macaw';

const MODES: MacawMode[] = ['flap', 'glide', 'dive', 'hover', 'land', 'walk', 'idle'];
const GROUNDED = new Set<MacawMode>(['walk', 'idle']);
const FLIGHT_HEIGHT = 0.7;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const background = new THREE.Color('#f6b877');
scene.background = background;
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.02, 100);
const controls = new OrbitControls(camera, renderer.domElement);

const sun = new THREE.DirectionalLight('#ffb36b', 3.2);
sun.position.set(-6, 1.6, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -1.8;
sun.shadow.camera.right = sun.shadow.camera.top = 1.8;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 14;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.004;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight('#ffd9b0', '#8a6e52', 1.3);
scene.add(hemi);
const fill = new THREE.DirectionalLight('#9fc4ff', 0.5);
fill.position.set(4, 3, -3);
scene.add(fill);

const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ color: '#d9b182', roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const birds = (['blueGold', 'scarlet'] as Species[]).map((species, i) => {
  const macaw = createMacaw(species);
  macaw.object.position.set(i === 0 ? -0.6 : 0.6, FLIGHT_HEIGHT, 0);
  scene.add(macaw.object);
  return macaw;
});

// Stand-ins for the environment's blend: the same lights and sky at night 0, a moonlit blue sky and dim cool light at night 1.
const NIGHT = { background: new THREE.Color('#0b1a3d'), sun: new THREE.Color('#8fb0ff'), sunIntensity: 0.9, hemiSky: new THREE.Color('#33508f'), hemiGround: new THREE.Color('#141c33'), hemiIntensity: 0.7, fillIntensity: 0.15, exposure: 1.4 };
const DAY = { background: background.clone(), sun: sun.color.clone(), sunIntensity: sun.intensity, hemiSky: hemi.color.clone(), hemiGround: hemi.groundColor.clone(), hemiIntensity: hemi.intensity, fillIntensity: fill.intensity, exposure: renderer.toneMappingExposure };
const conditions = { night: 0, wetness: 0 };
const lighting: { -readonly [K in keyof Lighting]: Lighting[K] } = {
  sunDirection: sun.position.clone().normalize(), sunColor: new THREE.Color(), hazeColor: new THREE.Color(), night: 0, morning: 0, rain: 0, wetness: 0, overcast: 0, rainbow: 0,
};

function applyConditions(): void {
  const n = conditions.night;
  background.lerpColors(DAY.background, NIGHT.background, n);
  sun.color.lerpColors(DAY.sun, NIGHT.sun, n);
  sun.intensity = THREE.MathUtils.lerp(DAY.sunIntensity, NIGHT.sunIntensity, n);
  hemi.color.lerpColors(DAY.hemiSky, NIGHT.hemiSky, n);
  hemi.groundColor.lerpColors(DAY.hemiGround, NIGHT.hemiGround, n);
  hemi.intensity = THREE.MathUtils.lerp(DAY.hemiIntensity, NIGHT.hemiIntensity, n);
  fill.intensity = THREE.MathUtils.lerp(DAY.fillIntensity, NIGHT.fillIntensity, n);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(DAY.exposure, NIGHT.exposure, n);
  lighting.night = n;
  lighting.wetness = conditions.wetness;
  lighting.rain = conditions.wetness;
  for (const b of birds) b.applyLighting(lighting);
}

const input: MacawAnimInput = { mode: 'glide', effort: 0.5, bank: 0, pitch: 0, walkSpeed: 0.3, look: 0 };

// Wing tip markers live in the scene, not the skeleton, so they prove the anchors' world matrices after update().
const tipMarkers = birds.flatMap((b) => b.wingTips.map(() => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: '#00ff66', depthTest: false }));
  m.renderOrder = 10;
  m.visible = false;
  scene.add(m);
  return m;
}));
const tipsEl = document.getElementById('tips') as HTMLInputElement;
function showTips(on: boolean): void {
  tipsEl.checked = on;
  for (const m of tipMarkers) m.visible = on;
}
tipsEl.onchange = () => showTips(tipsEl.checked);
const birdMeshes = birds[0].object.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
const trianglesPerBird = birdMeshes.reduce((n, m) => n + m.geometry.index!.count / 3, 0);

const CAMERAS: Record<string, { pos: THREE.Vector3; target: THREE.Vector3 }> = {
  overview: { pos: new THREE.Vector3(0, 1.4, 3.2), target: new THREE.Vector3(0, 0.55, 0) },
  chase: { pos: new THREE.Vector3(0, 2.2, 4.5), target: new THREE.Vector3(0, 0.6, -0.5) },
  chaseClose: { pos: new THREE.Vector3(-0.6, 1.6, 2.6), target: new THREE.Vector3(-0.6, 0.65, 0) },
  behindBG: { pos: new THREE.Vector3(-0.6, 1.0, 1.7), target: new THREE.Vector3(-0.6, 0.72, 0) },
  behindScarlet: { pos: new THREE.Vector3(0.6, 1.0, 1.7), target: new THREE.Vector3(0.6, 0.72, 0) },
  front: { pos: new THREE.Vector3(0, 1.0, -3.0), target: new THREE.Vector3(0, 0.6, 0) },
  side: { pos: new THREE.Vector3(3.0, 0.9, 0.3), target: new THREE.Vector3(0.2, 0.6, 0) },
  top: { pos: new THREE.Vector3(0, 4.2, 0.3), target: new THREE.Vector3(0, 0.6, 0) },
  closeBG: { pos: new THREE.Vector3(-1.25, 0.95, -0.75), target: new THREE.Vector3(-0.6, 0.75, -0.1) },
  closeScarlet: { pos: new THREE.Vector3(1.25, 0.95, -0.75), target: new THREE.Vector3(0.6, 0.75, -0.1) },
  headBG: { pos: new THREE.Vector3(-0.95, 0.85, -0.5), target: new THREE.Vector3(-0.6, 0.78, -0.2) },
  headScarlet: { pos: new THREE.Vector3(0.95, 0.85, -0.5), target: new THREE.Vector3(0.6, 0.78, -0.2) },
  groundSide: { pos: new THREE.Vector3(1.6, 0.35, 1.1), target: new THREE.Vector3(0, 0.12, 0) },
  groundFront: { pos: new THREE.Vector3(0.3, 0.4, -1.6), target: new THREE.Vector3(0, 0.12, 0) },
};

function setCamera(name: string): void {
  const c = CAMERAS[name] ?? CAMERAS.overview;
  cameraEl.value = name in CAMERAS ? name : 'overview';
  const grounded = GROUNDED.has(input.mode);
  const dy = grounded ? -FLIGHT_HEIGHT + 0.15 : 0;
  camera.position.copy(c.pos).add(new THREE.Vector3(0, name.startsWith('ground') ? 0 : dy, 0));
  controls.target.copy(c.target).add(new THREE.Vector3(0, name.startsWith('ground') ? 0 : dy, 0));
  controls.update();
}

function setMode(mode: MacawMode): void {
  input.mode = mode;
  for (const b of birds) b.object.position.y = GROUNDED.has(mode) ? b.footOffset : FLIGHT_HEIGHT;
  for (const el of document.querySelectorAll<HTMLButtonElement>('#modes button')) el.classList.toggle('on', el.textContent === mode);
}

const modesEl = document.getElementById('modes')!;
for (const m of MODES) {
  const b = document.createElement('button');
  b.textContent = m;
  b.onclick = () => setMode(m);
  modesEl.appendChild(b);
}
const slidersEl = document.getElementById('sliders')!;
const sliderSetters = new Map<string, (v: number) => void>();
function addSlider(key: string, min: number, max: number, initial: number, onInput: (v: number) => void): void {
  const label = document.createElement('label');
  const value = document.createElement('span');
  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = '0.01';
  const show = (v: number) => { range.value = String(v); value.textContent = range.value; };
  range.oninput = () => { show(Number(range.value)); onInput(Number(range.value)); };
  show(initial);
  sliderSetters.set(key, show);
  label.append(key, range, value);
  slidersEl.appendChild(label);
}
const SLIDERS: [keyof Omit<MacawAnimInput, 'mode'>, number, number][] = [['effort', 0, 1], ['bank', -1, 1], ['pitch', -1, 1], ['look', -1, 1], ['walkSpeed', 0, 1]];
for (const [key, min, max] of SLIDERS) addSlider(key, min, max, input[key], (v) => { input[key] = v; });
for (const key of ['night', 'wetness'] as const) addSlider(key, 0, 1, conditions[key], (v) => { conditions[key] = v; applyConditions(); });
document.getElementById('squawk')!.onclick = () => birds.forEach((b) => b.squawk());
const cameraEl = document.getElementById('camera') as HTMLSelectElement;
for (const name of Object.keys(CAMERAS)) cameraEl.add(new Option(name, name));
cameraEl.onchange = () => setCamera(cameraEl.value);

const infoEl = document.getElementById('info')!;
function step(dt: number): void {
  for (const b of birds) b.update(dt, input);
  birds.forEach((b, i) => b.wingTips.forEach((tip, k) => tipMarkers[i * 2 + k].position.setFromMatrixPosition(tip.matrixWorld)));
  renderer.render(scene, camera);
  const r = renderer.info.render;
  infoEl.textContent = `frame: calls ${r.calls}  tris ${r.triangles}  programs ${renderer.info.programs!.length}\nper bird: calls ${birdMeshes.length}  tris ${trianglesPerBird}\nfootOffset ${birds[0].footOffset.toFixed(3)}`;
}

let last = performance.now();
const frozen = new URLSearchParams(location.search).has('freeze'); // scripted shots then advance the animation only through macawDev.shot, so frames repeat exactly
renderer.setAnimationLoop((now) => {
  const dt = (now - last) / 1000;
  last = now;
  if (frozen) renderer.render(scene, camera);
  else step(dt);
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

setMode('glide');
setCamera('overview');

// Hooks for scripted screenshots: pose both birds, settle the springs synchronously, then render once.
Object.assign(window, {
  macawDev: {
    birds,
    camera,
    setMode,
    setCamera,
    look(px: number, py: number, pz: number, tx: number, ty: number, tz: number) {
      camera.position.set(px, py, pz);
      controls.target.set(tx, ty, tz);
      controls.update();
    },
    set(key: keyof Omit<MacawAnimInput, 'mode'>, v: number) { input[key] = v; },
    conditions(night: number, wetness: number) {
      Object.assign(conditions, { night, wetness });
      for (const key of ['night', 'wetness'] as const) sliderSetters.get(key)!(conditions[key]);
      applyConditions();
    },
    programIds: () => renderer.info.programs!.map((p) => p.id),
    squawk: () => birds.forEach((b) => b.squawk()),
    showTips,
    tips: () => birds.map((b) => b.wingTips.map((t) => t.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(3)))),
    atlas(i: number, which: 'map' | 'normalMap' = 'map') {
      const mesh = birds[i].object.children.find((c): c is THREE.SkinnedMesh => c instanceof THREE.SkinnedMesh)!;
      return ((mesh.material as THREE.MeshPhysicalMaterial)[which]!.image as HTMLCanvasElement).toDataURL();
    },
    advance(seconds: number) { for (let t = 0; t < seconds; t += 1 / 60) step(1 / 60); },
    shot(mode: MacawMode, cam: string, settle = 2, params: Partial<MacawAnimInput> = {}) {
      setMode(mode);
      Object.assign(input, params, { mode });
      setCamera(cam);
      this.advance(settle);
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, perBird: { calls: birdMeshes.length, triangles: trianglesPerBird }, footOffset: birds[0].footOffset };
    },
  },
});
