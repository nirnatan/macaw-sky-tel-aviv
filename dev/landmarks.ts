import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadCityData, type Building, type CityData } from '../src/world/data';
import { createLandmarks } from '../src/game/landmarks';
import type { TargetId } from '../src/contracts';
import { project } from '../src/geo';

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
const SKY = new THREE.Color('#f4bf86');
scene.background = SKY;
scene.fog = new THREE.Fog('#f2b98a', 900, 14000);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 40000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight('#ffe6c4', '#8a6a52', 1.1));
const sun = new THREE.DirectionalLight('#ffc98a', 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 1500 });
scene.add(sun, sun.target);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
if (params.get('bloom') !== '0') composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.85));
composer.addPass(new OutputPass());

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

const quality = (params.get('q') as 'low' | 'medium' | 'high') ?? 'high';
const landmarks = createLandmarks(data, { scene, quality });
const [schoolSpot, ganSpot] = landmarks.spots;
const ganGroup = landmarks.group.getObjectByName('gan')!;

const bird = new THREE.Vector3();
type View = { pos: THREE.Vector3; look: THREE.Vector3 };
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
  gulls: () => {
    const flock = landmarks.group.getObjectByName('gulls') as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    flock.getMatrixAt(0, m);
    const look = new THREE.Vector3().setFromMatrixPosition(m);
    return { pos: look.clone().add(new THREE.Vector3(25, 6, 25)), look };
  },
};

function setView(name: string) {
  const v = (views[name] ?? views.near)();
  camera.position.copy(v.pos);
  controls.target.copy(v.look);
  controls.update();
  sun.target.position.copy(v.look).setY(0);
  sun.position.copy(v.look).add(new THREE.Vector3(-500, 260, -80));
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
landmarks.update(0, camera, bird);
setView(params.get('view') ?? 'near');

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
Object.assign(window, { landmarks, data, camera, controls, setView, landmarkCalls, THREE });

const stats = document.getElementById('stats')!;
const timer = new THREE.Timer();
let frames = 0, acc = 0;
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  controls.update();
  bird.copy(controls.target);
  landmarks.update(dt, camera, bird);
  composer.render(dt);
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
