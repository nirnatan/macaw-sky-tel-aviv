// GLSL fragments shared by the city materials, all built on MeshStandardMaterial.onBeforeCompile so
// lights, shadows and fog keep working.
import * as THREE from 'three';

const GLSL_NOISE = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.3 + 7.1) * 0.3 + vnoise(p * 5.7 + 3.3) * 0.15; }
`;

/** Appends `code` right after the named include in a shader source. */
export function after(src: string, include: string, code: string): string {
  const tag = `#include <${include}>`;
  if (!src.includes(tag)) throw new Error(`shader include ${include} missing`);
  return src.replace(tag, `${tag}\n${code}`);
}

/** Adds `vWorldPos` (world-space position after instancing) and the noise functions to a standard material's
 *  shaders; `fragmentPreamble` lands after them so it can use both. */
export function withWorldPos(shader: THREE.WebGLProgramParametersWithUniforms, fragmentPreamble = ''): void {
  shader.vertexShader = after(shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;'),
    'begin_vertex',
    /* glsl */ `
    #ifdef USE_INSTANCING
      vWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
    #else
      vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
    #endif`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\n' + GLSL_NOISE + fragmentPreamble);
}

export function srgb(hex: string | number): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
