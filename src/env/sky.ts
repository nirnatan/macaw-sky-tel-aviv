import * as THREE from 'three';
import { ATMOSPHERE_GLSL, glslVec3, PALETTE } from './atmosphere';

// Streaky altocumulus on a plane above the camera, lit from below by the low sun. Shared with the sea's reflection.
export const CLOUDS_GLSL = /* glsl */ `
uniform sampler2D uCloudNoise;
const vec3 CLOUD_LIT = ${glslVec3(PALETTE.cloudLit)};
const vec3 CLOUD_SHADE = ${glslVec3(PALETTE.cloudShade)};
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
  float density = smoothstep(0.5, 0.74, n);
  vec2 toSun = CLOUD_ROT * normalize(SUN_DIR.xz) * CLOUD_STRETCH * 0.35;
  float towardSun = texture(uCloudNoise, uv + toSun).r;
  float lit = clamp(0.6 + (n - towardSun) * 4.0, 0.0, 1.0);
  float mu = max(dot(dir, SUN_DIR), 0.0);
  vec3 col = mix(CLOUD_SHADE, CLOUD_LIT, lit);
  col += HAZE_GLOW * pow(mu, 5.0) * (1.25 - density) * 1.6;
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
uniform float uSunDisk;
uniform float uEnvGround;
varying vec3 vDir;
${ATMOSPHERE_GLSL}
${CLOUDS_GLSL}
const vec3 SUN_DISK = ${glslVec3(PALETTE.sunDisk)};
const vec3 GROUND = ${glslVec3(PALETTE.ground)};
const float SUN_RADIUS = 0.014; // radians, ~3x the real sun so it reads on screen

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = atmoSky(dir);
  vec4 cl = clouds(dir, uTime);
  col = mix(col, cl.rgb, cl.a);
  float r = acos(clamp(dot(dir, SUN_DIR), -1.0, 1.0)) / SUN_RADIUS;
  float disk = 1.0 - smoothstep(0.85, 1.0, r);
  float limb = 0.55 + 0.45 * sqrt(max(1.0 - r * r, 0.0));
  col += SUN_DISK * disk * limb * (1.0 - cl.a * 0.85) * uSunDisk;
  col = mix(col, GROUND, uEnvGround * smoothstep(0.0, -0.12, dir.y));
  gl_FragColor = vec4(col, 1.0);
}`;

function skyMaterial(noise: THREE.Texture, envVariant: boolean) {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uSunDisk: { value: envVariant ? 0 : 1 },
      uEnvGround: { value: envVariant ? 1 : 0 },
      uCloudNoise: { value: noise },
    },
    defines: { CLOUD_DETAIL: 1 },
    side: THREE.BackSide,
    depthWrite: false,
  });
}

export function createSky(noise: THREE.Texture) {
  const geometry = new THREE.SphereGeometry(1, 48, 24);
  const material = skyMaterial(noise, false);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000; // after opaque geometry so early-z rejects covered sky pixels

  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(geometry, skyMaterial(noise, true)));

  return {
    mesh,
    envScene,
    setTime(t: number) { material.uniforms.uTime.value = t; },
    setCloudDetail(on: boolean) {
      material.defines.CLOUD_DETAIL = on ? 1 : 0;
      material.needsUpdate = true;
    },
  };
}
