import * as THREE from 'three';
import { ATMOSPHERE_GLSL, atmosphereUniforms } from './atmosphere';

// Streaky altocumulus on a plane above the camera, lit from below by the low sun, or by the moon at night.
// Shared with the sea's reflection. Overcast widens the coverage and flattens the lighting into a soft gray-blue ceiling.
export const CLOUDS_GLSL = /* glsl */ `
uniform sampler2D uCloudNoise;
uniform vec3 uAtmoMoonDir;
uniform vec3 uAtmoCloudLit;
uniform vec3 uAtmoCloudShade;
#define CLOUD_LIT uAtmoCloudLit
#define CLOUD_SHADE uAtmoCloudShade
const mat2 CLOUD_ROT = mat2(0.93, 0.36, -0.36, 0.93);
const vec2 CLOUD_STRETCH = vec2(0.075, 0.2);

vec4 clouds(vec3 dir, float t) {
  float fade = smoothstep(0.02, 0.22, dir.y);
  if (fade <= 0.0) return vec4(0.0);
  vec2 uv = CLOUD_ROT * (dir.xz / (dir.y + 0.07)) * CLOUD_STRETCH + vec2(t * 0.0016, t * 0.0003);
  float n = texture(uCloudNoise, uv).r;
#if CLOUD_DETAIL
  n += (texture(uCloudNoise, uv * 3.3 + vec2(0.31, 0.72)).g - 0.5) * 0.34;
#endif
  float overcast = ATMO_OVERCAST;
  float density = mix(smoothstep(0.5, 0.74, n), smoothstep(0.15, 0.5, n), overcast);
  density = max(density, overcast * overcast * 0.7); // flat stratus floor under heavy cover
  vec3 lightDir = normalize(mix(SUN_DIR, uAtmoMoonDir, smoothstep(0.15, 0.55, ATMO_NIGHT))); // moonlit once the sun side is gone
  vec2 toLight = CLOUD_ROT * (lightDir.xz / max(length(lightDir.xz), 1e-3)) * CLOUD_STRETCH * 0.35;
  float towardLight = texture(uCloudNoise, uv + toLight).r;
  float lit = clamp(0.6 + (n - towardLight) * 4.0, 0.0, 1.0);
  lit = mix(lit, 0.35, overcast * 0.7);
  float mu = max(dot(dir, lightDir), 0.0);
  vec3 col = mix(CLOUD_SHADE, CLOUD_LIT, lit);
  col += HAZE_GLOW * pow(mu, 5.0) * (1.25 - density) * 1.6 * (1.0 - overcast);
  col = mix(atmoHaze(dir), col, fade);
  return vec4(col, density * 0.92 * fade);
}
`;

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = (projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0)).xyww;
}`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uDecor;
uniform float uStarDensity;
uniform vec3 uSunDisk;
uniform vec3 uGround;
varying vec3 vDir;
${ATMOSPHERE_GLSL}
${CLOUDS_GLSL}
const float SUN_RADIUS = 0.014; // radians, ~3x the real sun so it reads on screen
const float MOON_RADIUS = 0.06; // a storybook moon
const vec3 MOON_COLOR = vec3(1.0, 0.97, 0.88);

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

vec3 stars(vec3 dir, float t) {
  float fade = smoothstep(0.0, 0.12, dir.y);
  if (fade <= 0.0) return vec3(0.0);
  vec3 p = dir * 70.0;
  vec3 cell = floor(p);
  vec3 h = hash33(cell);
  float present = step(1.0 - uStarDensity, h.x);
  vec3 center = cell + 0.25 + h * 0.5;
  float d = length(p - center);
  float size = 0.12 + h.y * 0.1;
  float core = smoothstep(size, size * 0.2, d);
  float twinkle = 0.7 + 0.3 * sin(t * (1.2 + h.z * 2.5) + h.y * 6.2832);
  vec3 tint = mix(vec3(0.82, 0.9, 1.0), vec3(1.0, 0.95, 0.82), h.z);
  return tint * core * present * (0.4 + h.y * 0.6) * twinkle * fade * 1.1;
}

vec3 spectrum(float x) { // 0 red, 0.15 orange, 0.25 yellow, 0.5 green, 0.75 blue, 1 violet
  return clamp(0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) - x * 0.78)), 0.0, 1.0);
}

vec3 rainbow(vec3 dir) {
  vec3 anti = -SUN_DIR;
  anti.y = -0.2079; // antisolar point pinned at -12 deg: the bow rises at noon and its apex (~30 deg) stays inside the chase frame at a low sun
  anti = normalize(anti);
  float ang = degrees(acos(clamp(dot(dir, anti), -1.0, 1.0)));
  float p = (ang - 40.4) / 2.0; // primary: violet inside, red outside
  float primary = smoothstep(0.0, 0.2, p) * (1.0 - smoothstep(0.8, 1.0, p));
  float s = (ang - 50.6) / 3.0; // secondary: reversed and faint
  float secondary = smoothstep(0.0, 0.25, s) * (1.0 - smoothstep(0.75, 1.0, s));
  vec3 col = spectrum(1.0 - clamp(p, 0.0, 1.0)) * primary + spectrum(clamp(s, 0.0, 1.0)) * secondary * 0.3;
  col += vec3(0.05) * (1.0 - smoothstep(37.0, 40.4, ang)); // slightly brighter sky inside the bow
  return col * smoothstep(-0.02, 0.1, dir.y);
}

void main() {
  vec3 dir = normalize(vDir);
  float nightVis = smoothstep(0.3, 0.9, ATMO_NIGHT);
  vec3 col = atmoSky(dir);
  col += stars(dir, uTime) * nightVis * (1.0 - ATMO_OVERCAST) * uDecor;
  vec4 cl = clouds(dir, uTime);
  col = mix(col, cl.rgb, cl.a);
  float cover = 1.0 - cl.a * 0.85;

  float r = acos(clamp(dot(dir, SUN_DIR), -1.0, 1.0)) / SUN_RADIUS;
  float disk = 1.0 - smoothstep(0.85, 1.0, r);
  float limb = 0.55 + 0.45 * sqrt(max(1.0 - r * r, 0.0));
  col += uSunDisk * disk * limb * cover * (1.0 - ATMO_NIGHT) * (1.0 - ATMO_OVERCAST) * uDecor;

  float mr = acos(clamp(dot(dir, uAtmoMoonDir), -1.0, 1.0)) / MOON_RADIUS;
  float mdisk = 1.0 - smoothstep(0.9, 1.0, mr);
  float mlimb = 0.72 + 0.28 * sqrt(max(1.0 - mr * mr, 0.0));
  float mhalo = exp(-mr * 0.6) * 0.2;
  col += MOON_COLOR * (mdisk * mlimb * 2.2 + mhalo) * nightVis * (1.0 - ATMO_OVERCAST * 0.9) * cover * uDecor;

  col += rainbow(dir) * ATMO_RAINBOW * (1.0 - cl.a * 0.6) * 0.55 * uDecor;
  col = mix(col, uGround, (1.0 - uDecor) * smoothstep(0.0, -0.12, dir.y));
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky(noise: THREE.Texture) {
  const shared = { // one set of arrays for the dome and the env-map variant
    uTime: { value: 0 },
    uStarDensity: { value: 0.3 },
    uSunDisk: { value: new Float32Array(3) },
    uGround: { value: new Float32Array(3) },
    uCloudNoise: { value: noise },
  };
  const skyMaterial = (decor: number) => new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: { ...atmosphereUniforms, ...shared, uDecor: { value: decor } }, // shared by reference, never cloned
    defines: { CLOUD_DETAIL: 1 },
    side: THREE.BackSide,
    depthWrite: false,
  });

  const geometry = new THREE.SphereGeometry(1, 48, 24);
  const material = skyMaterial(1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000; // after opaque geometry so early-z rejects covered sky pixels

  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(geometry, skyMaterial(0))); // no sun disk, stars, moon or rainbow in reflections

  return {
    mesh,
    envScene,
    uniforms: shared,
    setTime(t: number) { shared.uTime.value = t; },
    setStarDensity(d: number) { shared.uStarDensity.value = d; },
    setCloudDetail(on: boolean) {
      material.defines.CLOUD_DETAIL = on ? 1 : 0;
      material.needsUpdate = true;
    },
  };
}
