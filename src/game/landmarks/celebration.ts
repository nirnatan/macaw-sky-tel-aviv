import * as THREE from 'three';
import { fxMaterial, pointScale } from './fx';
import { instancedFrom, seeded } from './parts';

// Every particle is a closed-form function of time in the shader, so bursts cost nothing per frame on the CPU.
const GRAVITY = -7.5;
const PALETTES = [
  ['#ffd23f', '#ff7a1a'], ['#ff4fb8', '#ffd1f0'], ['#4dd8ff', '#ffffff'], ['#7dff6a', '#fff27a'], ['#b77dff', '#ff9ad5'], ['#ff3b3b', '#ffd23f'],
].map((p) => p.map((c) => new THREE.Color(c)));
const CONFETTI_COLORS = ['#ff4f6d', '#ffd23f', '#4dd8ff', '#7dff6a', '#b77dff', '#ff9f1c', '#ffffff'].map((c) => new THREE.Color(c));

export type BurstShape = 'star' | 'heart';

export interface Celebration {
  readonly objects: THREE.Object3D[];
  /** ~4 s show of rockets and confetti around `at`; the heart shape faces `viewer`. */
  burst(at: THREE.Vector3, shape: BurstShape, time: number, viewer: THREE.Vector3): void;
  /** Small golden flash, used when a ring is collected. */
  pop(at: THREE.Vector3, time: number): void;
  update(time: number, camera: THREE.Camera): void;
}

const FW_VERT = /* glsl */ `
  attribute vec3 aVel; attribute vec3 aColor; attribute vec4 aTime; // start, life, size, drag
  uniform float uTime; uniform float uScale;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float t = uTime - aTime.x;
    if (t < 0.0 || t > aTime.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    float k = aTime.w;
    float e = (1.0 - exp(-k * t)) / k;
    vec3 g = vec3(0.0, ${GRAVITY.toFixed(1)}, 0.0);
    vec3 p = position + (aVel + g / k) * e - g * t / k;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float life = t / aTime.y;
    gl_PointSize = max(1.5, uScale * aTime.z / -mv.z) * (1.0 - 0.5 * life);
    vAlpha = pow(1.0 - life, 1.4) * (0.75 + 0.25 * sin(t * 40.0 + position.x * 13.0));
    vColor = aColor;
  }`;
const FW_FRAG = /* glsl */ `
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float a = exp(-dot(d, d) * 22.0);
    gl_FragColor = vec4(mix(vColor, vec3(1.0), a * a * 0.6) * a * vAlpha * 3.0, 1.0);
  }`;

const CONFETTI_VERT = /* glsl */ `
  attribute vec3 aOrigin; attribute vec3 aVel; attribute vec4 aSpin; attribute vec2 aTime; attribute vec3 aColor;
  uniform float uTime;
  varying vec3 vColor; varying float vAlpha;
  vec3 rotate(vec3 v, vec3 axis, float a) { return v * cos(a) + cross(axis, v) * sin(a) + axis * dot(axis, v) * (1.0 - cos(a)); }
  void main() {
    float t = uTime - aTime.x;
    if (t < 0.0 || t > aTime.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float e = (1.0 - exp(-2.2 * t)) / 2.2;
    vec3 p = aOrigin + aVel * e + vec3(sin(t * 2.6 + aSpin.w * 6.3) * 0.9, -2.2 * t, cos(t * 2.1 + aSpin.w * 4.0) * 0.9);
    float ang = t * aSpin.w * 9.0 + aSpin.w * 6.3;
    vec3 axis = normalize(aSpin.xyz);
    vec3 n = rotate(vec3(0.0, 0.0, 1.0), axis, ang);
    gl_Position = projectionMatrix * viewMatrix * vec4(p + rotate(position, axis, ang), 1.0);
    vColor = aColor * (0.55 + 0.45 * abs(n.y) + 0.35 * pow(abs(n.z), 8.0));
    vAlpha = smoothstep(aTime.y, aTime.y - 0.8, t);
  }`;
const CONFETTI_FRAG = /* glsl */ `
  varying vec3 vColor; varying float vAlpha;
  void main() { if (vAlpha < 0.02) discard; gl_FragColor = vec4(vColor, vAlpha); }`;

class Pool {
  private cursor = 0;
  constructor(readonly size: number, private readonly attrs: THREE.BufferAttribute[]) {}
  /** Reserves `n` consecutive slots (wrapping), returning the start index. */
  take(n: number): number {
    if (this.cursor + n > this.size) this.cursor = 0;
    const start = this.cursor;
    this.cursor += n;
    for (const a of this.attrs) {
      a.addUpdateRange(start * a.itemSize, n * a.itemSize);
      a.needsUpdate = true;
    }
    return start;
  }
}

function heartPoint(a: number): [number, number] {
  const x = 16 * Math.sin(a) ** 3;
  const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
  return [x / 16, y / 16];
}

export function createCelebration(particleBudget: number): Celebration {
  const rand = seeded(42);
  const N = particleBudget;
  const pos = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
  const vel = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
  const col = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
  const tim = new THREE.BufferAttribute(new Float32Array(N * 4).fill(-1e6), 4);
  const fwGeo = new THREE.BufferGeometry();
  fwGeo.setAttribute('position', pos);
  fwGeo.setAttribute('aVel', vel);
  fwGeo.setAttribute('aColor', col);
  fwGeo.setAttribute('aTime', tim);
  const fwMat = fxMaterial({
    vertexShader: FW_VERT, fragmentShader: FW_FRAG,
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 } },
  });
  const fireworks = new THREE.Points(fwGeo, fwMat);
  fireworks.frustumCulled = false;
  fireworks.renderOrder = 4;
  const sparks = new Pool(N, [pos, vel, col, tim]);

  const CN = Math.floor(N / 6);
  const cOrigin = new THREE.InstancedBufferAttribute(new Float32Array(CN * 3), 3);
  const cVel = new THREE.InstancedBufferAttribute(new Float32Array(CN * 3), 3);
  const cSpin = new THREE.InstancedBufferAttribute(new Float32Array(CN * 4), 4);
  const cTime = new THREE.InstancedBufferAttribute(new Float32Array(CN * 2).fill(-1e6), 2);
  const cColor = new THREE.InstancedBufferAttribute(new Float32Array(CN * 3), 3);
  const cGeo = instancedFrom(new THREE.PlaneGeometry(0.45, 0.7), CN);
  cGeo.setAttribute('aOrigin', cOrigin);
  cGeo.setAttribute('aVel', cVel);
  cGeo.setAttribute('aSpin', cSpin);
  cGeo.setAttribute('aTime', cTime);
  cGeo.setAttribute('aColor', cColor);
  const cMat = fxMaterial({
    vertexShader: CONFETTI_VERT, fragmentShader: CONFETTI_FRAG, side: THREE.DoubleSide, depthWrite: true, blending: THREE.NormalBlending,
    uniforms: { uTime: { value: 0 } },
  });
  const confetti = new THREE.Mesh(cGeo, cMat);
  confetti.frustumCulled = false;
  const flakes = new Pool(CN, [cOrigin, cVel, cSpin, cTime, cColor]);

  let showUntil = -1;
  const show = (until: number) => { showUntil = Math.max(showUntil, until); };

  function emit(i: number, p: THREE.Vector3, v: THREE.Vector3, c: THREE.Color, start: number, life: number, size: number, drag: number) {
    pos.setXYZ(i, p.x, p.y, p.z);
    vel.setXYZ(i, v.x, v.y, v.z);
    col.setXYZ(i, c.r, c.g, c.b);
    tim.setXYZW(i, start, life, size, drag);
  }

  const v = new THREE.Vector3(), p = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  function shell(center: THREE.Vector3, explodeAt: number, shape: BurstShape, palette: THREE.Color[], facing: THREE.Vector3) {
    const rise = 1.1 + rand() * 0.4, height = 55 + rand() * 40;
    const launch = center.clone().add(new THREE.Vector3((rand() - 0.5) * 30, 0, (rand() - 0.5) * 30));
    const burstPos = launch.clone().add(new THREE.Vector3((rand() - 0.5) * 20, height, (rand() - 0.5) * 20));
    const k = 0.6;
    // Initial velocity that reaches burstPos exactly at `rise` seconds under gravity and drag.
    const e = (1 - Math.exp(-k * rise)) / k;
    const vy = ((burstPos.y - launch.y) + (GRAVITY * rise) / k) / e - GRAVITY / k;
    const trail = 10;
    let i = sparks.take(trail);
    for (let j = 0; j < trail; j++) {
      v.set((burstPos.x - launch.x) / e, vy, (burstPos.z - launch.z) / e);
      emit(i + j, launch, v, palette[1], explodeAt - rise + j * 0.025, rise - j * 0.025, 1.6 - j * 0.11, k);
    }
    const count = shape === 'heart' ? 170 : 150;
    i = sparks.take(count);
    right.crossVectors(up, facing).normalize();
    for (let j = 0; j < count; j++) {
      const speed = 27 + rand() * 6;
      if (shape === 'heart' && j < 110) {
        const [hx, hy] = heartPoint((j / 110) * Math.PI * 2);
        v.copy(right).multiplyScalar(hx * speed).addScaledVector(up, hy * speed + 2);
      } else {
        const z = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
        v.set(r * Math.cos(a), z, r * Math.sin(a)).multiplyScalar(speed * (shape === 'heart' ? 0.55 : 1));
      }
      emit(i + j, burstPos, v, palette[j % 3 === 0 ? 1 : 0], explodeAt, 1.8 + rand() * 0.9, 3.2 + rand() * 1.6, 1.5);
    }
  }

  return {
    objects: [fireworks, confetti],
    burst(at, shape, time, viewer) {
      const facing = viewer.clone().sub(at).setY(0);
      if (facing.lengthSq() < 1e-6) facing.set(0, 0, 1);
      facing.normalize();
      for (let s = 0; s < 7; s++) {
        const palette = PALETTES[Math.floor(rand() * PALETTES.length)];
        shell(at, time + 1.2 + s * 0.42 + rand() * 0.2, s % 2 === 0 ? shape : 'star', palette, facing);
      }
      const n = Math.min(CN, 420);
      const i = flakes.take(n);
      for (let j = 0; j < n; j++) {
        const side = j % 2 ? 1 : -1;
        const a = rand() * Math.PI * 2, spread = 3 + rand() * 6;
        p.set(at.x + side * 3, at.y + 0.5, at.z);
        cOrigin.setXYZ(i + j, p.x, p.y, p.z);
        cVel.setXYZ(i + j, Math.cos(a) * spread + side * 4, 16 + rand() * 12, Math.sin(a) * spread);
        const ax = rand() - 0.5, ay = rand() - 0.5, az = rand() - 0.5;
        cSpin.setXYZW(i + j, ax, ay, az + 0.01, 0.4 + rand());
        cTime.setXY(i + j, time + rand() * 0.6, 5 + rand() * 2.5);
        const c = CONFETTI_COLORS[j % CONFETTI_COLORS.length];
        cColor.setXYZ(i + j, c.r, c.g, c.b);
      }
      show(time + 8);
    },
    pop(at, time) {
      const n = 48;
      const i = sparks.take(n);
      const gold = PALETTES[0];
      for (let j = 0; j < n; j++) {
        const z = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
        v.set(r * Math.cos(a), z, r * Math.sin(a)).multiplyScalar(9 + rand() * 4);
        emit(i + j, at, v, gold[j % 2], time, 0.7 + rand() * 0.4, 0.9 + rand() * 0.6, 2.5);
      }
      show(time + 1.2);
    },
    update(time, camera) {
      const active = time < showUntil;
      fireworks.visible = confetti.visible = active;
      if (!active) return;
      fwMat.uniforms.uTime.value = time;
      cMat.uniforms.uTime.value = time;
      fwMat.uniforms.uScale.value = pointScale(camera);
    },
  };
}
