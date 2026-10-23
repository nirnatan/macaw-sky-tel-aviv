// Stand-alone harness for src/world/city.ts: real data, temporary golden-hour lighting, orbit camera and presets.
// Exposes window.setPreset(name), window.setQuality(q), window.stats() and window.city for scripted screenshots.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { City, Quality } from '../src/contracts';
import { createCity } from '../src/world/city';
import { loadCityData } from '../src/world/data';

const PRESETS: Record<string, { pos: [number, number, number]; look: [number, number, number] }> = {
  overview: { pos: [-1900, 600, 1500], look: [-2300, 0, 600] },
  rothschild: { pos: [-1850, 55, 1250], look: [-2300, 10, 1680] },
  roof: { pos: [1700, 28, -2990], look: [1730, 14, -2960] },
  facade: { pos: [1700, 9, -2974], look: [1732, 7, -2963] },
  school: { pos: [1760, 80, -2860], look: [1845, 12, -2940] },
  beach: { pos: [-2960, 45, 300], look: [-2990, 20, -400] },
  fringe: { pos: [4000, 350, 0], look: [8000, 40, 0] },
};

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f5c48e');
scene.fog = new THREE.Fog('#f0bf8a', 1500, 9000);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 30000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const sunDirection = new THREE.Vector3(-0.8, 0.26, 0.4).normalize(); // WSW, low
const sun = new THREE.DirectionalLight('#ffc98a', 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 50;
sun.shadow.camera.far = 3000;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight('#9fb8d8', '#b58a5c', 0.9));

const data = await loadCityData();
const t0 = performance.now();
const city: City = createCity(data, { scene, quality: 'high', sunDirection });
const buildMs = performance.now() - t0;
scene.add(city.group);
scene.add(seaPlane(data.sea));

const hud = document.getElementById('hud')!;
const presetBox = document.getElementById('presets')!;
let quality: Quality = 'high';
let lastSurface = '';
const fps = { frames: 0, last: performance.now(), value: 0 };
const gpu = gpuTimer(renderer.getContext() as WebGL2RenderingContext);

function setPreset(name: string): void {
  const p = PRESETS[name];
  if (!p) throw new Error(`unknown preset ${name}`);
  camera.position.set(...p.pos);
  controls.target.set(...p.look);
  controls.update();
}
function setView(pos: [number, number, number], look: [number, number, number]): void {
  camera.position.set(...pos);
  controls.target.set(...look);
  controls.update();
}
function setQuality(q: Quality): void { quality = q; city.setQuality(q); }
function stats() {
  const r = renderer.info.render;
  return { calls: r.calls, triangles: r.triangles, fps: Math.round(fps.value), gpuMs: gpu.ms, buildMs: Math.round(buildMs), quality };
}
Object.assign(window, { setPreset, setView, setQuality, stats, city, data, THREE });

for (const name of Object.keys(PRESETS)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => setPreset(name);
  presetBox.appendChild(b);
}
for (const q of ['low', 'medium', 'high'] as Quality[]) {
  const b = document.createElement('button');
  b.textContent = `quality: ${q}`;
  b.onclick = () => setQuality(q);
  presetBox.appendChild(b);
}
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
});

setPreset('overview');
renderer.setAnimationLoop(() => {
  controls.update();
  const focus = controls.target;
  sun.position.copy(focus).addScaledVector(sunDirection, 1200);
  sun.target.position.copy(focus);
  const span = Math.max(150, camera.position.distanceTo(focus) * 0.9);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -span;
  cam.right = cam.top = span;
  cam.updateProjectionMatrix();
  city.update(camera);
  gpu.begin();
  renderer.render(scene, camera);
  gpu.end();
  fps.frames++;
  const now = performance.now();
  if (now - fps.last > 500) { fps.value = (fps.frames * 1000) / (now - fps.last); fps.frames = 0; fps.last = now; }
  const r = renderer.info.render, m = renderer.info.memory;
  hud.textContent = [
    `calls ${r.calls}  tris ${(r.triangles / 1e6).toFixed(2)}M  fps ${fps.value.toFixed(0)}  gpu ${gpu.ms ?? '?'} ms  quality ${quality}`,
    `geometries ${m.geometries}  textures ${m.textures}  build ${buildMs.toFixed(0)} ms`,
    `cam ${camera.position.x.toFixed(0)}, ${camera.position.y.toFixed(0)}, ${camera.position.z.toFixed(0)}`,
    lastSurface || 'click: surfaceAt',
  ].join('\n');
});

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
