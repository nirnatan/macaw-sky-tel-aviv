import * as THREE from 'three';
import { fxMaterial } from './fx';
import { lit, type Mood } from './mood';
import { seeded } from './parts';

export interface Bulb { position: THREE.Vector3; color: THREE.Color; size: number } // size in meters

/** Night-only twinkling light bulbs (gan fairy lights, house string lights): one additive point cloud, one shared program. */
export interface Bulbs {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  applyLighting(m: Mood): void;
  /** `pointScale` turns the bulb size in meters into pixels. */
  update(time: number, pointScale: number): void;
}

export function createBulbs(bulbs: Bulb[], seed: number): Bulbs {
  const rand = seeded(seed);
  const pos: number[] = [], color: number[] = [], bulb: number[] = [];
  for (const b of bulbs) {
    pos.push(b.position.x, b.position.y, b.position.z);
    color.push(b.color.r, b.color.g, b.color.b);
    bulb.push(b.size, rand() * 6.28);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(color, 3));
  g.setAttribute('aBulb', new THREE.Float32BufferAttribute(bulb, 2));
  const material = fxMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uGlow: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute vec2 aBulb; // size in meters, twinkle phase
      uniform float uTime; uniform float uScale; uniform float uGlow;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        mv.xyz -= normalize(mv.xyz) * 0.25; // in front of the bulb or rail it hangs on, so the glow is not cut by it
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(2.0, uScale * aBulb.x / -mv.z);
        vAlpha = uGlow * (0.7 + 0.3 * sin(uTime * 2.3 + aBulb.y));
        vColor = aColor;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d);
        vec3 c = vColor * exp(-r2 * 14.0) * 0.5 + mix(vColor, vec3(1.0), 0.6) * exp(-r2 * 70.0);
        gl_FragColor = vec4(c * vAlpha * 2.2, 1.0);
      }`,
  });
  const points = new THREE.Points(g, material);
  points.renderOrder = 2;
  return {
    points,
    applyLighting(m) {
      points.visible = lit(m);
      material.uniforms.uGlow.value = m.glow;
    },
    update(time, pointScale) {
      material.uniforms.uTime.value = time;
      material.uniforms.uScale.value = pointScale;
    },
  };
}
