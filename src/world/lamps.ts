// Street lamps: one additive glow sprite per lamp head in a single THREE.Points, and the matching light pools the
// flats shader paints under them. Both read LAMP, so a sprite always has its pool and a pool always has its sprite.
import * as THREE from 'three';
import type { Ring } from './data';
import { releaseAfterUpload, walkPolyline } from './geom';
import type { CityUniforms } from './shaders';

export const LAMP = {
  minHw: 2.9, // narrowest road half width with lamps (residential streets); service lanes stay dark
  spacing: 44, // meters between stations along a road; the first sits half a spacing in
  bothSidesHw: 7.5, // roads at least this wide (half width) light both curbs, narrower ones alternate sides
  curb: 0.6, // lateral offset past the paved edge
  height: 6.5,
  poolRadius: 8,
  intensity: 220, // point-light intensity behind the wet-road glints, matched to the brightness of the painted pools
} as const;
const LAMP_RGB = 'vec3(1.0, 0.76, 0.46)';

/** Appends [x, y, z, halfWidth] per lamp along a road, on the same stations lampPool() finds in the shader. */
export function addLampStations(out: number[], pts: Ring, hw: number, yAt: (s: number) => number): void {
  if (hw < LAMP.minHw) return;
  const offset = hw + LAMP.curb, both = hw >= LAMP.bothSidesHw;
  let k = 0;
  walkPolyline(pts, LAMP.spacing, LAMP.spacing / 2, (x, z, dx, dz) => {
    const y = yAt(LAMP.spacing / 2 + k * LAMP.spacing) + LAMP.height;
    const side = k % 2 === 0 ? 1 : -1; // +1 is the ribbon's +v edge, left of the travel direction
    out.push(x - dz * offset * side, y, z + dx * offset * side, hw);
    if (both) out.push(x + dz * offset * side, y, z - dx * offset * side, hw);
    k++;
  });
}

/** Ribbon coordinates: s along the road, signed lateral v (+ on the left), paved half width hw. */
export const LAMP_POOL_GLSL = /* glsl */ `
const vec3 LAMP_RGB = ${LAMP_RGB};
const float LAMP_SPACING = ${LAMP.spacing.toFixed(1)};
const float LAMP_HEIGHT = ${LAMP.height.toFixed(1)};
float lampOffset(float hw) { return hw + ${LAMP.curb.toFixed(2)}; }
bool lampBothSides(float hw) { return hw >= ${LAMP.bothSidesHw.toFixed(2)}; }
float lampSide(float k) { return mod(k, 2.0) < 0.5 ? 1.0 : -1.0; }

/** Light pool strength (0..1) under the nearest lamp. */
float lampPool(float s, float v, float hw) {
  if (hw < uPoolMinHw) return 0.0;
  float k = max(floor(s / LAMP_SPACING), 0.0);
  float ds = s - LAMP_SPACING * (k + 0.5);
  float dv = lampBothSides(hw) ? abs(v) - lampOffset(hw) : v - lampSide(k) * lampOffset(hw);
  return exp(-(ds * ds + dv * dv) * ${(1 / LAMP.poolRadius ** 2).toFixed(5)});
}

/** World xz offset per unit of ribbon (s, v). s and v are affine on each triangle, so screen derivatives give the
 *  exact map; call it outside branches, where derivatives are defined. */
mat2 ribbonToWorld(vec2 wp, float s, float v) {
  mat2 screenToRibbon = mat2(dFdx(s), dFdx(v), dFdy(s), dFdy(v));
  float det = determinant(screenToRibbon);
  return abs(det) > 1e-10 ? mat2(dFdx(wp), dFdy(wp)) * inverse(screenToRibbon) : mat2(0.0);
}

/** GGX glints of the lamps around this point: the long streaks a wet road shows toward the viewer. */
vec3 lampGlints(mat2 toWorld, vec3 wp, float s, float v, float hw, float roughness) {
  float k0 = max(floor(s / LAMP_SPACING), 0.0);
  bool both = lampBothSides(hw);
  vec3 V = normalize(cameraPosition - wp);
  float a2 = pow(max(roughness, 0.12), 4.0); // the puddle floor keeps a mirror point from aliasing
  float sum = 0.0;
  for (int i = -1; i <= 1; i++) {
    float k = k0 + float(i);
    if (k < 0.0) continue;
    for (int j = 0; j < 2; j++) {
      if (j == 1 && !both) break;
      float side = both ? float(1 - 2 * j) : lampSide(k);
      vec2 d = toWorld * vec2(LAMP_SPACING * (k + 0.5) - s, side * lampOffset(hw) - v);
      vec3 L = vec3(d.x, LAMP_HEIGHT, d.y);
      float d2 = dot(L, L);
      L *= inversesqrt(d2);
      vec3 H = normalize(L + V);
      float vh = max(dot(V, H), 0.0), q = H.y * H.y * (a2 - 1.0) + 1.0;
      sum += a2 / (PI * q * q) * (0.02 + 0.98 * pow(1.0 - vh, 5.0)) * 0.25 / max(vh * vh, 0.1) * L.y / d2;
    }
  }
  return LAMP_RGB * min(sum * ${LAMP.intensity.toFixed(1)}, 3.0);
}
`;

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uNight, uScreenH, fogDensity;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = 3.2 * uScreenH * projectionMatrix[1][1] * 0.5 / max(-mv.z, 1.0);
  gl_PointSize = clamp(px, 1.0, 64.0);
  float warm = fract(sin(dot(floor(position.xz), vec2(12.9898, 78.233))) * 43758.5453);
  vec3 tint = mix(${LAMP_RGB}, vec3(1.0, 0.9, 0.74), step(0.7, warm)); // a few whiter LED heads among the sodium-warm ones
  float fade = exp(-fogDensity * length(mv.xyz)) * min(1.0, px * px / 4.0); // sub-2px heads dim instead of shimmering
  vColor = tint * 2.6 * uNight * fade;
  #include <logdepthbuf_vertex>
}`;

const fragmentShader = /* glsl */ `
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c);
  if (r2 > 0.25) discard;
  float glow = exp(-r2 * 110.0) + exp(-r2 * 14.0) * 0.22 * (1.0 - 4.0 * r2);
  gl_FragColor = vec4(vColor * glow, 1.0);
}`;

export interface Lamps {
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Draws only lamps on roads at least `hw` wide; the list is sorted widest first, so this is one draw range. */
  setMinHalfWidth(hw: number): void;
}

export function buildLamps(stations: number[], uniforms: CityUniforms): Lamps {
  const n = stations.length / 4;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => stations[4 * b + 3] - stations[4 * a + 3]);
  const position = new Float32Array(n * 3), halfWidth = new Float32Array(n);
  order.forEach((src, dst) => {
    position.set(stations.slice(4 * src, 4 * src + 3), 3 * dst);
    halfWidth[dst] = stations[4 * src + 3];
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.computeBoundingSphere();
  releaseAfterUpload(geometry.attributes.position as THREE.BufferAttribute);

  const screenH = { value: 720 };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uNight: uniforms.uNight, uScreenH: screenH },
    vertexShader, fragmentShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'street lamps';
  points.matrixAutoUpdate = false;
  const size = new THREE.Vector2();
  points.onBeforeRender = (renderer) => {
    const target = renderer.getRenderTarget();
    screenH.value = target ? target.height : renderer.getDrawingBufferSize(size).y;
  };
  return {
    points,
    setMinHalfWidth(hw) {
      let count = 0;
      while (count < n && halfWidth[count] >= hw) count++;
      geometry.setDrawRange(0, count);
    },
  };
}
