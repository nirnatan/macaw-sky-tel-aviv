import * as THREE from 'three';
import { fxMaterial } from './fx';
import { instancedFrom, Parts } from './parts';
import { RING_RADIUS, type RingSpec } from './route';

const POP_SECONDS = 0.7;
const GOLD = '#ffc63a';

export interface RingView {
  readonly objects: THREE.Object3D[];
  /** Marks ring i popped at `time`; it swells, flashes, and fades away. */
  pop(i: number, time: number): void;
  update(time: number, rings: readonly { collected: boolean }[]): void;
}

function ringGeometry(): THREE.BufferGeometry {
  const parts = new Parts().add(new THREE.TorusGeometry(RING_RADIUS, 0.42, 14, 56), GOLD);
  parts.add(new THREE.TorusGeometry(RING_RADIUS, 0.16, 6, 56), '#fff3c4', new THREE.Matrix4().makeScale(1.13, 1.13, 1)); // outer bright lip
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const gem = new THREE.OctahedronGeometry(i % 2 ? 0.45 : 0.62);
    parts.add(gem, i % 2 ? '#7fe8ff' : '#ff5fa2', new THREE.Matrix4().makeTranslation(Math.cos(a) * RING_RADIUS, Math.sin(a) * RING_RADIUS, 0));
  }
  return parts.build();
}

/** MeshStandardMaterial with a per-instance (fade, glow) attribute. */
function ringMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.3, emissive: '#ff9a1a', emissiveIntensity: 0.9, transparent: true });
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRing;\nvarying vec2 vRing;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRing = aRing;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRing;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vRing.y;\ndiffuseColor.a *= vRing.x;');
  };
  return mat;
}

function haloMesh(count: number): { mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>; center: THREE.InstancedBufferAttribute; glow: THREE.InstancedBufferAttribute } {
  const g = instancedFrom(new THREE.PlaneGeometry(1, 1), count);
  const center = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const glow = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  glow.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aCenter', center);
  g.setAttribute('aGlow', glow);
  const mat = fxMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter; attribute float aGlow;
      uniform float uTime;
      varying vec2 vUv; varying float vAlpha;
      void main() {
        vec4 mv = viewMatrix * vec4(aCenter, 1.0);
        float dist = -mv.z;
        float emphasis = step(1.5, aGlow);
        float pulse = 1.0 + emphasis * 0.25 * sin(uTime * 4.0);
        mv.xy += position.xy * max(16.0, dist * 0.03) * (1.0 + emphasis * 0.2) * pulse;
        gl_Position = projectionMatrix * mv;
        vUv = uv;
        float far = mix(smoothstep(3200.0, 1200.0, dist), 1.0, emphasis);
        vAlpha = min(aGlow, 1.0) * far * smoothstep(20.0, 120.0, dist) * (0.45 + emphasis * 0.15);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying float vAlpha;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float core = exp(-d * d * 9.0);
        float rim = exp(-pow((d - 0.5) * 6.0, 2.0)) * 0.6;
        gl_FragColor = vec4(vec3(1.0, 0.66, 0.18) * (core * 0.6 + rim) * vAlpha, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, center, glow };
}

export function createRingView(specs: RingSpec[]): RingView {
  const n = specs.length;
  const geometry = ringGeometry();
  const fadeGlow = new THREE.InstancedBufferAttribute(new Float32Array(n * 2).fill(1), 2);
  fadeGlow.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aRing', fadeGlow);
  const mesh = new THREE.InstancedMesh(geometry, ringMaterial(), n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;

  const halo = haloMesh(n);
  specs.forEach((s, i) => halo.center.setXYZ(i, s.position.x, s.position.y, s.position.z));

  const facing = specs.map((s) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.normal));
  const popAt = new Float32Array(n).fill(-1);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), wobble = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();

  return {
    objects: [mesh, halo.mesh],
    pop(i, time) { popAt[i] = time; },
    update(time, rings) {
      halo.mesh.material.uniforms.uTime.value = time;
      let last = -1;
      rings.forEach((r, i) => { if (r.collected) last = i; });
      const firstOpen = (from: number) => rings.findIndex((r, i) => i >= from && !r.collected);
      let next = firstOpen(last + 1);
      if (next < 0) next = firstOpen(0);

      for (let i = 0; i < n; i++) {
        const age = popAt[i] < 0 ? 1 : (time - popAt[i]) / POP_SECONDS; // collected without a pop: already gone
        let scale = 1, fade = 1, glow = 1 + 0.15 * Math.sin(time * 2 + i);
        if (rings[i].collected) {
          const t = Math.min(age, 1);
          scale = t >= 1 ? 0 : 1 + 0.9 * (1 - (1 - t) ** 3);
          fade = 1 - t;
          glow = 1 + 4 * (1 - t);
        } else if (i === next) {
          glow = 1.6 + 0.5 * Math.sin(time * 4);
        }
        e.set(0, Math.sin(time * 0.6 + i) * 0.14, time * 0.5 + i);
        q.copy(facing[i]).multiply(wobble.setFromEuler(e));
        m.compose(specs[i].position, q, sc.setScalar(scale));
        mesh.setMatrixAt(i, m);
        fadeGlow.setXY(i, fade, glow);
        halo.glow.setX(i, rings[i].collected ? 0 : i === next ? 2 : 1);
      }
      mesh.instanceMatrix.needsUpdate = true;
      fadeGlow.needsUpdate = true;
      halo.glow.needsUpdate = true;
    },
  };
}
