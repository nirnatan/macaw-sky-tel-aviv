import * as THREE from 'three';
import type { Quality } from '../src/contracts';
import { createEnvironment } from '../src/env';
import { loadCityData, type Ring } from '../src/world/data';

const COAST_X = -3300;

function insidePolygon(ring: Ring, x: number, z: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function placeholderBlocks(sea: Ring) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const matrices: THREE.Matrix4[] = [];
  for (let x = COAST_X - 300; x < COAST_X + 1800; x += 42) {
    for (let z = -1800; z < 1800; z += 42) {
      const px = x + (rand() - 0.5) * 14, pz = z + (rand() - 0.5) * 14;
      if (insidePolygon(sea, px - 70, pz) || insidePolygon(sea, px, pz)) continue;
      const w = 14 + rand() * 16, d = 14 + rand() * 16, h = 10 + Math.pow(rand(), 1.6) * 50;
      matrices.push(new THREE.Matrix4().compose(
        new THREE.Vector3(px, h / 2, pz),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rand() - 0.5) * 0.3),
        new THREE.Vector3(w, h, d),
      ));
    }
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0xf2eee6, roughness: 0.82 }), matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

interface Preset { position: [number, number, number]; target: [number, number, number]; drift?: [number, number, number] }
const PRESETS: Record<string, Preset> = {
  beach: { position: [COAST_X + 420, 80, 120], target: [COAST_X - 900, -60, 380] },
  east: { position: [COAST_X - 260, 40, 260], target: [COAST_X + 400, 25, -60] },
  streets: { position: [COAST_X + 250, 110, 300], target: [COAST_X + 650, 0, 150] },
  overview: { position: [COAST_X + 900, 300, 1500], target: [COAST_X - 200, 0, -700] },
  skim: { position: [COAST_X - 150, 3, 150], target: [COAST_X - 1100, 2, 400], drift: [-22, 0, 6] },
};

const params = new URLSearchParams(location.search);
let quality = (params.get('q') ?? 'high') as Quality;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.setSize(innerWidth, innerHeight);
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 30000);
const data = await loadCityData();

const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb59f86, roughness: 1 }));
ground.position.x = 5000;
ground.receiveShadow = true;
scene.add(ground, placeholderBlocks(data.sea));

const buildStart = performance.now();
const env = createEnvironment({ renderer, scene, camera, sea: data.sea, quality });
const envBuildMs = Math.round(performance.now() - buildStart);

const focus = new THREE.Vector3();
let preset = params.get('preset') ?? 'beach';
let presetTime = 0;
let speed = 0;

function applyPreset(dt: number) {
  const p = PRESETS[preset];
  const drift = new THREE.Vector3(...(p.drift ?? [0, 0, 0])).multiplyScalar(presetTime);
  camera.position.set(...p.position).add(drift);
  const target = new THREE.Vector3(...p.target).add(drift);
  camera.lookAt(target);
  focus.copy(camera.position).lerp(target, preset === 'beach' || preset === 'skim' ? 0.03 : 0.6);
  env.update(dt, focus);
}

const hud = document.getElementById('hud')!;
const controls = document.getElementById('controls')!;
const button = (label: string, onClick: () => void) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = onClick;
  controls.append(b);
};
for (const name of Object.keys(PRESETS)) button(name, () => setPreset(name));
for (const q of ['low', 'medium', 'high'] as const) button(q, () => setQuality(q));
button('speed', () => env.setSpeedEffect((speed = speed > 0 ? 0 : 1)));

function setPreset(name: string) { preset = name; presetTime = 0; return name; }
function setQuality(q: Quality) { quality = q; env.setQuality(q); return q; }

const timer = new THREE.Timer();
let frames = 0, fpsTime = 0, fps = 0;
function frame(dt: number) {
  presetTime += dt;
  applyPreset(dt);
  renderer.info.reset();
  env.render(dt);
}

function updateHud(dt: number) {
  frames++; fpsTime += dt;
  if (fpsTime > 0.5) { fps = frames / fpsTime; frames = 0; fpsTime = 0; }
  const { render, memory, programs } = renderer.info;
  hud.textContent = `${fps.toFixed(0)} fps  ${quality}  ${preset}  dpr ${renderer.getPixelRatio()}  env build ${envBuildMs} ms\n`
    + `calls ${render.calls}  tris ${render.triangles}  geo ${memory.geometries}  tex ${memory.textures}  programs ${programs?.length ?? 0}`;
}

renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  frame(dt);
  updateHud(dt);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  env.setSize(innerWidth, innerHeight);
});

// Throughput benchmark: renders `count` frames back to back and syncs the GPU once with a readPixels.
function benchmark(count = 120, pixelRatio?: number) {
  renderer.setAnimationLoop(null);
  if (pixelRatio) { renderer.setPixelRatio(pixelRatio); env.setSize(innerWidth, innerHeight); }
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  for (let i = 0; i < 10; i++) frame(1 / 60);
  sync();
  const start = performance.now();
  for (let i = 0; i < count; i++) frame(1 / 60);
  sync();
  const ms = (performance.now() - start) / count;
  return { quality, preset, pixelRatio: renderer.getPixelRatio(), ms: +ms.toFixed(2), fps: +(1000 / ms).toFixed(1), calls: renderer.info.render.calls };
}

Object.assign(window, {
  scene, renderer, camera, env, envBuildMs,
  setPreset, setQuality, benchmark,
  setSpeed: (a: number) => env.setSpeedEffect((speed = a)),
  advance: (seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) frame(1 / 30); },
});
