import * as THREE from 'three';
import type { Quality } from '../src/contracts';
import { createEnvironment } from '../src/env';
import { createTurboFlames } from '../src/fx/turbo-flames';

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.info.autoReset = false;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 30000);
const COAST = -800; // the sea lies west of this x, as in Tel Aviv
const FAR = 20000;
const AREA = 3000;
const coastline = Array.from({ length: 121 }, (_, i) => {
  const z = -AREA + i * 50;
  return [COAST + Math.sin(z * 0.004) * 60, z];
}).flat();
const sea = new Float32Array([...coastline, COAST, FAR, -FAR, FAR, -FAR, -FAR, COAST, -FAR]); // only the short coast edges count as shore
let quality: Quality = (params.get('q') as Quality) ?? 'high';
const env = createEnvironment({ renderer, scene, camera, sea, quality });

function groundTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b3aa9c';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = Math.random() < 0.3 ? '#6f6a64' : `hsl(${25 + Math.random() * 20}, ${10 + Math.random() * 15}%, ${62 + Math.random() * 22}%)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 18, 4 + Math.random() * 18);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(160, 160);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(FAR, FAR * 2).rotateX(-Math.PI / 2).translate(COAST + FAR / 2, 0, 0), new THREE.MeshLambertMaterial({ map: groundTexture() }));
ground.receiveShadow = true;
scene.add(ground);

const towers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: '#eadbc6' }), 1800);
const m = new THREE.Matrix4();
for (let i = 0; i < towers.count; i++) {
  const w = 12 + Math.random() * 25, h = 6 + Math.random() * Math.random() * 45;
  m.makeScale(w, h, 12 + Math.random() * 25).setPosition(COAST + 100 + Math.random() * (AREA - COAST), 0, (Math.random() - 0.5) * AREA * 2);
  towers.setMatrixAt(i, m);
  towers.setColorAt(i, new THREE.Color().setHSL(0.08 + Math.random() * 0.04, 0.12, 0.75 + Math.random() * 0.15));
}
towers.castShadow = towers.receiveShadow = true;
scene.add(towers);

const SPAN = 1.05;
const bird = new THREE.Group();
bird.rotation.order = 'YXZ';
const feathers = new THREE.MeshStandardMaterial({ color: '#1f5fd0', roughness: 0.7 });
bird.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12).scale(1, 0.9, 3.2), feathers));
const wings = [-1, 1].map((side) => {
  const pivot = new THREE.Group();
  pivot.position.x = side * 0.08;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(SPAN / 2 - 0.08, 0.02, 0.22).translate(side * (SPAN / 4 - 0.04), 0, 0.02), feathers);
  const tip = new THREE.Object3D();
  tip.position.x = side * (SPAN / 2 - 0.08);
  pivot.add(wing, tip);
  bird.add(pivot);
  return { pivot, tip, side };
});
scene.add(bird);

const flames = createTurboFlames({ quality });
scene.add(flames.object);
env.setSize(innerWidth, innerHeight);
function setQuality(q: Quality) {
  quality = q;
  env.setQuality(q);
  env.setSize(innerWidth, innerHeight);
  flames.setQuality(q);
  renderPanel();
}

const START = new THREE.Vector3(COAST + 300, 85, 0);
const flight = {
  position: START.clone(),
  velocity: new THREE.Vector3(),
  yaw: 0, bank: 0, pitch: 0, speed: 30, boost: 0, time: 0,
  turbo: params.get('turbo') !== '0', amountMax: 1, turn: null as number | null,
};
const views = {
  chase: { yaw: 0, elev: 0.2, dist: null as number | null },
  side: { yaw: Math.PI / 2, elev: 0.08, dist: 6 },
  quarter: { yaw: 2.3, elev: 0.25, dist: 5 },
  above: { yaw: 0.4, elev: 0.9, dist: 6 },
  close: { yaw: 1.9, elev: 0.15, dist: 3.5 },
};
type View = keyof typeof views;
let orbit = { ...views.chase };
let viewName: View = 'chase';
const damp = (a: number, b: number, rate: number, dt: number) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-rate * dt));

const forward = new THREE.Vector3();
const desired = new THREE.Vector3();
const look = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const tips: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
let camDist = 4;

function fly(dt: number) {
  const f = flight;
  f.time += dt;
  f.boost = damp(f.boost, f.turbo ? 1 : 0, 3, dt);
  const yawRate = f.turn ?? Math.sin(f.time * 0.45) * 0.55 + Math.sin(f.time * 0.17 + 1) * 0.35;
  f.yaw += yawRate * dt;
  f.bank = damp(f.bank, THREE.MathUtils.clamp(-yawRate * 1.1, -1, 1), 4, dt);
  const vy = Math.cos(f.time * 0.3) * 0.3 * 12;
  f.pitch = Math.atan2(vy, f.speed);
  forward.set(-Math.sin(f.yaw), 0, -Math.cos(f.yaw));
  f.velocity.copy(forward).multiplyScalar(f.speed).setY(vy);
  f.position.addScaledVector(f.velocity, dt);
  if (Math.abs(f.position.x) > AREA) f.position.x -= Math.sign(f.position.x) * AREA * 2; // wraps around, which also exercises the teleport guard
  if (Math.abs(f.position.z) > AREA) f.position.z -= Math.sign(f.position.z) * AREA * 2;

  bird.position.copy(f.position);
  bird.rotation.set(f.pitch, f.yaw, -f.bank);
  const flap = Math.sin(f.time * Math.PI * 2 * 5) * 0.45 + 0.1;
  for (const w of wings) w.pivot.rotation.z = -w.side * flap;
  bird.updateMatrixWorld(true);
  wings.forEach((w, i) => w.tip.getWorldPosition(tips[i]));
}

function chase(dt: number, snap = false) {
  const f = flight;
  const speedNorm = THREE.MathUtils.clamp(f.speed / 44, 0, 1);
  camDist = snap ? orbit.dist ?? 2.7 + speedNorm * 2.4 : damp(camDist, orbit.dist ?? 2.7 + speedNorm * 2.4, 2, dt);
  const yaw = f.yaw + orbit.yaw;
  const elev = orbit.elev - f.pitch * 0.45;
  desired.set(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev)).multiplyScalar(camDist).add(f.position);
  camera.position.lerp(desired, snap ? 1 : 1 - Math.exp(-7 * dt));
  lookTarget.copy(f.position).addScaledVector(forward, orbit.yaw === 0 ? 1.8 : 0).setY(f.position.y + 0.3);
  look.lerp(lookTarget, snap ? 1 : 1 - Math.exp(-12 * dt));
  camera.lookAt(look);
  camera.rotateZ(-f.bank * 0.22);
  const fov = 60 + f.boost * 16 + speedNorm * 6;
  camera.fov = snap ? fov : damp(camera.fov, fov, 3, dt);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

const panel = {
  turbo: document.getElementById('turbo') as HTMLButtonElement,
  amount: document.getElementById('amount') as HTMLInputElement,
  speed: document.getElementById('speed') as HTMLInputElement,
  speedVal: document.getElementById('speedVal')!,
  views: document.getElementById('views')!,
  qualities: document.getElementById('qualities')!,
  stats: document.getElementById('stats')!,
};
function button(label: string, on: boolean, click: () => void) {
  const b = document.createElement('button');
  b.textContent = label;
  b.classList.toggle('on', on);
  b.onclick = click;
  return b;
}
function renderPanel() {
  panel.turbo.classList.toggle('on', flight.turbo);
  panel.speed.value = String(flight.speed);
  panel.speedVal.textContent = `${flight.speed.toFixed(0)} m/s`;
  panel.amount.value = String(flight.amountMax);
  panel.views.replaceChildren(...(Object.keys(views) as View[]).map((v) => button(v, v === viewName, () => setView(v))));
  panel.qualities.replaceChildren(...(['low', 'medium', 'high'] as Quality[]).map((q) => button(q, q === quality, () => setQuality(q))));
}
function setView(v: View) { viewName = v; orbit = { ...views[v] }; renderPanel(); }
panel.turbo.onclick = () => { flight.turbo = !flight.turbo; renderPanel(); };
panel.amount.oninput = () => { flight.amountMax = Number(panel.amount.value); };
panel.speed.oninput = () => { flight.speed = Number(panel.speed.value); renderPanel(); };
addEventListener('keydown', (e) => { if (e.code === 'Space') { flight.turbo = !flight.turbo; renderPanel(); } });
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); env.setSize(innerWidth, innerHeight); });

const flameGeometry = (flames.object as THREE.Points).geometry;
const flameMaterial = (flames.object as THREE.Points).material as THREE.ShaderMaterial;
function aliveParticles() {
  const data = flameGeometry.getAttribute('aData');
  const now = flameMaterial.uniforms.uTime.value as number;
  let alive = 0;
  for (let i = 0; i < data.count; i++) if (now - data.getX(i) < data.getY(i) && data.getZ(i) > 0) alive++;
  return alive;
}

const stats = { fps: 0, updateMs: 0, calls: 0, alive: 0, capacity: flameGeometry.getAttribute('position').count, cameraDistance: 0 };
const timer = new THREE.Timer();
let frames = 0, frameTime = 0, updateTime = 0;
fly(0);
chase(0, true);
renderPanel();

const minFrameTime = 1 / Number(params.get('fps') ?? 1000); // ?fps=30 mimics an iPad that cannot keep up
let pending = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  timer.update(now);
  pending += timer.getDelta();
  if (pending < minFrameTime * 0.95) return;
  const dt = Math.min(pending, 1 / 20);
  pending = 0;
  fly(dt);
  chase(dt);
  const t0 = performance.now();
  flames.update(dt, flight.boost * flight.amountMax, tips, flight.velocity, camera);
  updateTime += performance.now() - t0;
  env.setSpeedEffect(flight.boost * 0.8);
  env.update(dt, flight.position);
  renderer.info.reset();
  env.render(dt);
  frames++;
  frameTime += dt;
  if (frameTime > 0.5) {
    stats.fps = frames / frameTime;
    stats.updateMs = updateTime / frames;
    stats.calls = renderer.info.render.calls;
    stats.alive = aliveParticles();
    stats.cameraDistance = camera.position.distanceTo(flight.position);
    panel.stats.textContent = `${stats.fps.toFixed(0)} fps · ${stats.calls} draw calls (flames: 1) · flames.update ${(stats.updateMs * 1000).toFixed(0)} µs\n`
      + `particles alive ${stats.alive} / ${stats.capacity} · amount ${(flight.boost * flight.amountMax).toFixed(2)} · camera ${stats.cameraDistance.toFixed(1)} m · ${quality}`;
    frames = 0; frameTime = 0; updateTime = 0;
  }
}
requestAnimationFrame(frame);

Object.assign(window, {
  flames: {
    setTurbo(on: boolean) { flight.turbo = on; renderPanel(); },
    setSpeed(v: number) { flight.speed = v; renderPanel(); },
    setAmount(v: number) { flight.amountMax = v; renderPanel(); },
    setTurn(rate: number | null) { flight.turn = rate; },
    restart(yaw = 0) { Object.assign(flight, { time: 0, yaw, bank: 0 }); flight.position.copy(START); fly(0); chase(0, true); },
    setQuality,
    setView,
    setOrbit(yaw: number, elev: number, dist: number) { orbit = { yaw, elev, dist }; },
    stats: () => ({ ...stats }),
    bench(updates = 5000, speed = 44) { // CPU cost of flames.update alone, with the GPU upload ranges cleared the way a render would
      const buffer = (flameGeometry.getAttribute('position') as THREE.InterleavedBufferAttribute).data;
      const velocity = new THREE.Vector3(0, 0, -speed);
      const benchTips: [THREE.Vector3, THREE.Vector3] = [tips[0].clone(), tips[1].clone()];
      let written = 0;
      const t0 = performance.now();
      for (let i = 0; i < updates; i++) {
        for (const tip of benchTips) tip.addScaledVector(velocity, 1 / 60);
        flames.update(1 / 60, 1, benchTips, velocity, camera);
        for (const r of buffer.updateRanges) written += r.count;
        buffer.clearUpdateRanges();
      }
      const ms = performance.now() - t0;
      return { quality, microsecondsPerUpdate: (ms * 1000) / updates, slotsWrittenPerUpdate: written / buffer.stride / updates };
    },
  },
});
