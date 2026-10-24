import * as THREE from 'three';
import type { Ring } from '../world/data';
import { ATMOSPHERE_GLSL, atmosphereUniforms } from './atmosphere';
import { CLOUDS_GLSL } from './sky';
import { SHORE_MAX_DISTANCE } from './textures';

function triangulateSea(sea: Ring) {
  const contour: THREE.Vector2[] = [];
  for (let i = 0; i < sea.length; i += 2) contour.push(new THREE.Vector2(sea[i], sea[i + 1]));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  const positions = new Float32Array(contour.length * 3);
  contour.forEach((p, i) => positions.set([p.x, 0, p.y], i * 3));
  const index: number[] = [];
  for (const [a, b, c] of faces) {
    const [pa, pb, pc] = [contour[a], contour[b], contour[c]];
    const upward = (pb.y - pa.y) * (pc.x - pa.x) - (pb.x - pa.x) * (pc.y - pa.y) > 0;
    index.push(a, ...(upward ? [b, c] : [c, b]));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

const vertexShader = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform sampler2D uNormals;
uniform sampler2D uShore;
uniform vec4 uShoreRect;
uniform vec3 uSunRadiance;
uniform vec3 uKeyDir;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uAmbient;
uniform float uRough;
uniform float uRain;
uniform float fogDensity;
varying vec3 vWorld;
${ATMOSPHERE_GLSL}
${CLOUDS_GLSL}

vec2 slope(vec2 uv) { return texture(uNormals, uv).rg * 2.0 - 1.0; }

float shoreDistance(vec2 p) {
  vec2 uv = (p - uShoreRect.xy) * uShoreRect.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return ${SHORE_MAX_DISTANCE.toFixed(1)};
  return texture(uShore, uv).r * ${SHORE_MAX_DISTANCE.toFixed(1)};
}

vec2 hash22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

// Expanding rings from raindrops: one drop per cell on two grids, each ring a short lifetime.
vec2 rainRings(vec2 p, float t) {
  vec2 acc = vec2(0.0);
  for (int i = 0; i < 2; i++) {
    vec2 q = p * (i == 0 ? 0.9 : 1.6) + float(i) * 7.3;
    vec2 cell = floor(q), f = fract(q) - 0.5;
    vec2 h = hash22(cell);
    vec2 toDrop = f - (h - 0.5) * 0.5;
    float life = fract(t * 1.1 + h.x * 9.0 + h.y * 3.0);
    float d = length(toDrop);
    float ring = sin((d - life * 0.55) * 34.0) * exp(-abs(d - life * 0.55) * 22.0) * (1.0 - life) * life * 4.0;
    acc += toDrop / max(d, 1e-3) * ring;
  }
  return acc;
}

void main() {
  vec3 toFrag = vWorld - cameraPosition;
  float dist = length(toFrag);
  vec3 V = -toFrag / dist;
  vec2 p = vWorld.xz;
  float t = uTime;

  // Fine layers fade out before their tiling turns into moire; the broad ones carry the far sea.
  vec2 swell = slope(p / 71.0 + t * vec2(0.0085, 0.0021));
  vec2 wp = p + swell * 1.2; // domain warp breaks the finer layers' tiling grid
  vec2 s = swell * 0.35
         + slope(mat2(0.8, -0.6, 0.6, 0.8) * wp / 23.0 + t * vec2(0.016, -0.006)) * 0.55 * (1.0 - smoothstep(300.0, 1500.0, dist))
         + slope(mat2(0.6, 0.8, -0.8, 0.6) * wp / 8.1 + t * vec2(0.031, 0.019)) * 0.65 * (1.0 - smoothstep(80.0, 500.0, dist));
  s += slope(mat2(-0.28, 0.96, -0.96, -0.28) * p / 2.7 + t * vec2(-0.045, 0.06)) * 0.55 * (1.0 - smoothstep(25.0, 160.0, dist));
  s += rainRings(p, t) * uRain * 0.6 * (1.0 - smoothstep(15.0, 140.0, dist));
  float shore = shoreDistance(p);
  float gusts = texture(uCloudNoise, p / 900.0 + t * vec2(0.0004, 0.0001)).r;
  float calm = mix(0.55, 1.0, smoothstep(0.0, 60.0, shore)) * mix(0.7, 1.25, smoothstep(0.3, 0.75, gusts)) * uRough;
  vec3 N = normalize(vec3(s.x * 0.14 * calm, 1.0, s.y * 0.14 * calm));

  float NdotV = max(dot(N, V), 1e-3);
  float NdotL = max(dot(N, uKeyDir), 0.0);
  vec3 body = mix(uShallow, uDeep, smoothstep(3.0, 120.0, shore));
  vec3 bodyLit = body * (uAmbient + uSunRadiance * (0.015 + 0.03 * NdotL));

  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = atmoSky(R);
#if CLOUD_REFLECTION
  vec3 smoothR = reflect(-V, normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.7))); // clouds alias under full wave detail
  vec4 cl = clouds(smoothR, t);
  refl = mix(refl, cl.rgb, cl.a * 0.7 * smoothstep(0.1, 0.4, smoothR.y));
#endif
  float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
  vec3 col = mix(bodyLit, refl, fresnel);

  // Key-light glitter (sun or moon): microfacet lobe whose roughness grows with distance to stand in for sub-pixel waves.
  vec3 H = normalize(V + uKeyDir);
  float NdotH = max(dot(N, H), 0.0);
  float alpha = mix(0.012, 0.075, smoothstep(20.0, 3000.0, dist));
  float a2 = alpha * alpha;
  float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * denom * denom);
  float FH = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  col += min(uSunRadiance * D * FH * NdotL / (4.0 * NdotV), vec3(48.0)) * (1.0 - ATMO_OVERCAST);

  float n1 = texture(uNormals, p / 11.0 + t * vec2(0.010, 0.004)).b;
  float n2 = texture(uNormals, p / 3.7 - t * vec2(0.006, 0.011)).b;
  float breakup = n1 * 0.6 + n2 * 0.4;
  float wash = 1.0 - smoothstep(0.5, 5.0 + breakup * 7.0, shore);
  float crest = smoothstep(0.93, 1.0, sin(shore * 0.24 + t * 1.25 + n1 * 3.0)) * (1.0 - smoothstep(8.0, 45.0, shore)) * smoothstep(0.4, 0.62, breakup);
  float foam = clamp(wash * smoothstep(0.2, 0.5, breakup + wash * 0.4) + crest * 0.55, 0.0, 1.0);
  vec3 foamLit = vec3(0.85) * (uAmbient * 0.8 + uSunRadiance * 0.18 * (0.3 + NdotL));
  col = mix(col, foamLit, foam * 0.9);

  gl_FragColor = vec4(atmoApply(col, toFrag, fogDensity), 1.0);
}`;

export interface SeaTextures { normals: THREE.Texture; shore: THREE.Texture; shoreRect: THREE.Vector4; clouds: THREE.Texture }

export function createSea(sea: Ring, textures: SeaTextures) {
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    ...atmosphereUniforms, // shared by reference, never cloned
    uTime: { value: 0 },
    uNormals: { value: textures.normals },
    uShore: { value: textures.shore },
    uShoreRect: { value: textures.shoreRect },
    uCloudNoise: { value: textures.clouds },
    uSunRadiance: { value: new THREE.Color() },
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
    uDeep: { value: new THREE.Color() },
    uShallow: { value: new THREE.Color() },
    uAmbient: { value: new THREE.Color() },
    uRough: { value: 1 },
    uRain: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms,
    defines: { CLOUD_REFLECTION: 1, CLOUD_DETAIL: 0 },
    fog: true,
    polygonOffset: true, // wins over a coplanar ground plane that runs under the sea
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(triangulateSea(sea), material);
  mesh.name = 'sea';
  return {
    mesh,
    uniforms,
    setTime(t: number) { uniforms.uTime.value = t; },
    setDetail(on: boolean) {
      material.defines.CLOUD_REFLECTION = on ? 1 : 0;
      material.needsUpdate = true;
    },
  };
}
