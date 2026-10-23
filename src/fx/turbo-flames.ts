import * as THREE from 'three';
import type { CreateTurboFlames, Quality } from '../contracts';
import { fxMaterial } from '../game/landmarks/fx';
import { createFlameSprites } from './flame-sprites';

type StreamName = 'body' | 'core' | 'spark';
interface Stream {
  kind: number; // shader branch
  inherit: number; // share of the bird's velocity a particle is born with; the rest is how fast it falls behind
  spread: number; // m/s of random velocity
  outward: number; // m/s along the wing, away from the body
  lift: number; // m/s upward
  life: readonly [number, number]; // seconds at 44 m/s; slower flight stretches it so the trail stays 4-8 m long
  size: readonly [number, number]; // meters
  gain: number;
  continuous: boolean; // overlapping puffs whose brightness is normalized for speed and tier, as opposed to discrete sparks
}

const STREAMS: Record<StreamName, Stream> = {
  body: { kind: 0, inherit: 0.6, spread: 0.8, outward: 0.5, lift: 0, life: [0.22, 0.34], size: [0.45, 0.8], gain: 2.2, continuous: true },
  core: { kind: 1, inherit: 0.6, spread: 0.25, outward: 0.25, lift: 0, life: [0.09, 0.15], size: [0.16, 0.24], gain: 4, continuous: true },
  spark: { kind: 2, inherit: 0.88, spread: 3, outward: 0.8, lift: 0.5, life: [0.5, 1.0], size: [0.04, 0.1], gain: 1, continuous: false },
};
const STREAM_NAMES = Object.keys(STREAMS) as StreamName[];
const RATES: Record<Quality, Record<StreamName, number>> = { // particles per wing per second at full turbo
  high: { body: 480, core: 360, spark: 70 },
  medium: { body: 280, core: 220, spark: 45 },
  low: { body: 140, core: 120, spark: 25 },
};
const SLOW_STRETCH = 1.5; // life multiplier at 15 m/s
const GLOW_SIZE = 0.55;
const GLOW_KIND = 3;
const TELEPORT = 6; // meters per frame beyond which the tip jumped rather than flew

const STRIDE = 12; // position xyz, velocity xyz + kind, birth, life, size, seed, energy
const RING = Math.ceil(2 * STREAM_NAMES.reduce((n, s) => n + RATES.high[s] * STREAMS[s].life[1] * SLOW_STRETCH, 0) * 1.1);
const GLOW_SLOT = RING; // the two tip glows sit after the ring

const VERT = /* glsl */ `
  attribute vec4 aVel; attribute vec4 aData; attribute float aEnergy;
  uniform float uTime; uniform float uScale;
  varying vec4 vColor; varying vec2 vRot; varying vec2 vCell; varying float vKind; varying float vStretch;
  const vec3 HOT = vec3(4.2, 3.3, 1.8);
  const vec3 GOLD = vec3(3.2, 1.45, 0.2);
  const vec3 AMBER = vec3(3.0, 0.65, 0.06);
  const vec3 EMBER = vec3(1.6, 0.22, 0.02);
  void main() {
    float t = uTime - aData.x;
    float u = t / aData.y;
    if (u < 0.0 || u > 1.0 || aData.z <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    float seed = aData.w;
    float size = aData.z;
    vec3 p = position;
    vec3 color;
    float cover = 0.0;
    float spin = seed * 6.283;
    if (aVel.w < 1.5) {
      float core = aVel.w;
      p += aVel.xyz * (1.0 - exp(-3.2 * t)) / 3.2 + vec3(0.0, 1.2 * t * t, 0.0);
      float phase = aData.x * 21.0 + (position.x + position.z) * 0.7; // shared by neighbours, so the stream curls in coherent tongues
      p += vec3(sin(phase + t * 6.0), sin(phase * 1.3 + 1.7 + t * 5.0), cos(phase * 0.8 + t * 7.0)) * mix(0.35, 0.12, core) * u;
      p += vec3(sin(t * 17.0 + seed * 40.0), sin(t * 13.0 + seed * 23.0), cos(t * 15.0 + seed * 31.0)) * mix(0.12, 0.04, core) * u;
      float envelope = smoothstep(0.0, 0.05, u) * pow(1.0 - u, mix(1.2, 1.6, core));
      if (core > 0.5) {
        color = mix(HOT, GOLD, smoothstep(0.2, 1.0, u));
        size *= 1.0 - 0.4 * u;
      } else {
        color = mix(mix(HOT, GOLD, 0.7), GOLD, smoothstep(0.0, 0.15, u));
        color = mix(color, AMBER, smoothstep(0.2, 0.6, u));
        color = mix(color, EMBER, smoothstep(0.7, 1.0, u));
        cover = 3.5 * envelope * (1.0 - 0.6 * smoothstep(0.4, 1.0, u)); // some occlusion keeps the gold readable against the sunset glare
        size *= (0.5 + 0.9 * smoothstep(0.0, 0.35, u)) * (1.0 - 0.55 * smoothstep(0.45, 1.0, u)); // a comet tail: swells, then tapers
      }
      color *= envelope * (0.8 + 0.2 * sin(t * 47.0 + seed * 60.0));
      float across = length(cross(normalize(aVel.xyz + 1e-4), normalize(p - cameraPosition)));
      float endOn = mix(0.6, 1.0, across); // seen end-on the puffs stack up, so dim them to keep the stream gold instead of white
      color *= endOn;
      cover *= endOn;
    } else if (aVel.w < 2.5) {
      p += aVel.xyz * (1.0 - exp(-0.9 * t)) / 0.9 + vec3(0.0, 0.3 * t * t, 0.0);
      float twinkle = 0.55 + 0.45 * sin(t * (18.0 + seed * 22.0) + seed * 50.0);
      color = mix(vec3(6.0, 5.2, 3.2), vec3(3.6, 1.8, 0.4), u) * twinkle * smoothstep(1.0, 0.6, u);
      spin += t * 3.0;
    } else {
      color = mix(GOLD, HOT, 0.6) * (0.85 + 0.15 * sin(uTime * 31.0 + seed * 17.0));
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    if (aVel.w < 1.5 || aVel.w > 2.5) size *= clamp(-mv.z / 6.0, 1.0, 1.7); // flames read as big from the far chase camera as from up close
    float px = uScale * size / -mv.z;
    vStretch = 1.0;
    if (aVel.w < 1.5) { // flames stretch along the trail as it appears on screen, and stay round seen end-on
      vec4 ahead = projectionMatrix * modelViewMatrix * vec4(p + normalize(aVel.xyz + 1e-4) * size, 1.0);
      vec2 d = (ahead.xy / max(ahead.w, 1e-3) - gl_Position.xy / gl_Position.w) * vec2(projectionMatrix[1][1] / projectionMatrix[0][0], 1.0);
      float along = length(d) * uScale / projectionMatrix[1][1] / max(px, 1.0);
      vStretch = ahead.w > 0.05 ? 1.0 + 1.8 * clamp(along, 0.0, 1.0) : 1.0;
      spin = atan(-d.y, d.x) + (seed - 0.5) * 0.5;
      px *= 0.6 + 0.4 * vStretch;
    }
    gl_PointSize = clamp(px, 2.0, 400.0);
    color *= min(1.0, px * px / 4.0); // sub-2px sparks dim instead of shrinking, so they twinkle without aliasing
    vColor = vec4(color, cover) * aEnergy * smoothstep(0.5, 2.0, -mv.z); // fade what streams past the chase camera
    vRot = vec2(cos(spin), sin(spin));
    float cell = floor(fract(seed * 7.31) * 4.0);
    vCell = vec2(mod(cell, 2.0), floor(cell / 2.0));
    vKind = aVel.w;
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D uSprites;
  varying vec4 vColor; varying vec2 vRot; varying vec2 vCell; varying float vKind; varying float vStretch;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    vec2 q = vec2(vRot.x * c.x + vRot.y * c.y, -vRot.y * c.x + vRot.x * c.y);
    q.y *= vStretch;
    float r2 = dot(q, q);
    if (r2 > 0.25) discard;
    float m;
    if (vKind < 0.5) {
      m = texture2D(uSprites, (q + 0.5 + vCell) * 0.5).r;
    } else if (vKind < 1.5) {
      m = exp(-r2 * 18.0);
    } else if (vKind < 2.5) {
      vec2 a = abs(q);
      m = exp(-r2 * 80.0) + (exp(-a.x * 40.0 - a.y * 5.0) + exp(-a.y * 40.0 - a.x * 5.0)) * 0.5 * (1.0 - 4.0 * r2);
    } else {
      m = exp(-r2 * 60.0) + exp(-r2 * 14.0) * 0.4;
    }
    gl_FragColor = vColor * m;
  }`;

export const createTurboFlames: CreateTurboFlames = ({ quality }) => {
  const array = new Float32Array((RING + 2) * STRIDE);
  for (let i = 0; i < RING; i++) array[i * STRIDE + 7] = -1e6;
  for (let side = 0; side < 2; side++) {
    const o = (GLOW_SLOT + side) * STRIDE;
    array[o + 6] = GLOW_KIND;
    array[o + 8] = 1e9; // glows never expire; their size goes to 0 instead
    array[o + 10] = side * 0.37;
  }
  const buffer = new THREE.InterleavedBuffer(array, STRIDE).setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
  geometry.setAttribute('aVel', new THREE.InterleavedBufferAttribute(buffer, 4, 3));
  geometry.setAttribute('aData', new THREE.InterleavedBufferAttribute(buffer, 4, 7));
  geometry.setAttribute('aEnergy', new THREE.InterleavedBufferAttribute(buffer, 1, 11));

  const material = fxMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uSprites: { value: createFlameSprites() } },
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, // premultiplied: additive where alpha is 0
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // world-space particles; the object's own transform never moves
  points.renderOrder = 6;
  const drawSize = new THREE.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    const height = renderer.getRenderTarget()?.height ?? renderer.getDrawingBufferSize(drawSize).y;
    material.uniforms.uScale.value = (height * camera.projectionMatrix.elements[5]) / 2;
  };

  let rates = RATES[quality];
  let time = 0;
  let cursor = 0;
  let runStart = -1;
  let runLength = 0;
  let primed = false;
  let glow = 0;
  const lastTips = [new THREE.Vector3(), new THREE.Vector3()];
  const debt = [{ body: 0, core: 0, spark: 0 }, { body: 0, core: 0, spark: 0 }];
  const outward = new THREE.Vector3();

  function flushRun() {
    if (runLength > 0) buffer.addUpdateRange(runStart * STRIDE, runLength * STRIDE);
    runStart = -1;
    runLength = 0;
  }

  function slot(): number {
    if (cursor === RING) { flushRun(); cursor = 0; }
    if (runStart < 0) runStart = cursor;
    runLength++;
    return cursor++ * STRIDE;
  }

  const between = (range: readonly [number, number]) => range[0] + Math.random() * (range[1] - range[0]);
  const jitter = (scale: number) => (Math.random() - 0.5) * scale;

  return {
    object: points,
    update(dt, amount, tips, velocity) {
      time += dt;
      glow = Math.max(amount, glow - dt * 4); // the tip glow dies with the last flames instead of popping off
      material.uniforms.uTime.value = time;
      const speed = velocity.length();
      const stretch = THREE.MathUtils.lerp(SLOW_STRETCH, 1, THREE.MathUtils.clamp((speed - 15) / 29, 0, 1));
      const density = Math.min(1, amount * 3); // full density early in the ramp so a dim stream is still unbroken
      outward.subVectors(tips[0], tips[1]).normalize();

      for (let side = 0; side < 2; side++) {
        const tip = tips[side], from = lastTips[side];
        if (!primed || from.distanceToSquared(tip) > TELEPORT * TELEPORT) from.copy(tip);
        const sign = side === 0 ? 1 : -1;
        const dx = tip.x - from.x, dy = tip.y - from.y, dz = tip.z - from.z;
        const pulse = 0.7 + 0.3 * Math.sin(time * 31 + side * 2.1) * Math.sin(time * 13 + side * 4.3); // bright bands travelling down the stream read as licks

        for (const name of STREAM_NAMES) {
          const st = STREAMS[name];
          const rate = rates[name] * (st.continuous ? density : amount);
          debt[side][name] += rate * dt;
          const count = Math.floor(debt[side][name]);
          if (count === 0) continue;
          debt[side][name] -= count;
          const energy = st.continuous ? (st.gain * amount * pulse * (speed * (1 - st.inherit) + 2)) / rate : st.gain * amount; // overlap-normalized: same trail brightness at any speed and tier
          const sizeScale = st.continuous ? (0.7 + 0.3 * amount) * (0.85 + 0.15 * pulse) : 1;
          for (let i = 0; i < count; i++) {
            const s = (i + Math.random()) / count;
            const o = slot();
            array[o] = from.x + dx * s; array[o + 1] = from.y + dy * s; array[o + 2] = from.z + dz * s;
            array[o + 3] = velocity.x * st.inherit + outward.x * st.outward * sign + jitter(st.spread);
            array[o + 4] = velocity.y * st.inherit + outward.y * st.outward * sign + jitter(st.spread) + st.lift;
            array[o + 5] = velocity.z * st.inherit + outward.z * st.outward * sign + jitter(st.spread);
            array[o + 6] = st.kind;
            array[o + 7] = time - dt * (1 - s);
            array[o + 8] = between(st.life) * stretch;
            array[o + 9] = between(st.size) * sizeScale;
            array[o + 10] = Math.random();
            array[o + 11] = st.continuous ? energy * (0.5 + Math.random()) : energy;
          }
        }

        from.copy(tip);
        const g = (GLOW_SLOT + side) * STRIDE;
        array[g] = tip.x; array[g + 1] = tip.y; array[g + 2] = tip.z;
        array[g + 9] = glow > 0.01 ? GLOW_SIZE * (0.4 + 0.6 * glow) : 0;
        array[g + 11] = glow * 0.8;
      }
      primed = true;
      flushRun();
      buffer.addUpdateRange(GLOW_SLOT * STRIDE, 2 * STRIDE);
      buffer.needsUpdate = true;
    },
    setQuality(q) { rates = RATES[q]; },
  };
};
