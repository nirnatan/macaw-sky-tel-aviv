import * as THREE from 'three';

/**
 * ShaderMaterial for the glowing effects, patched with three's log-depth chunks so it depth-tests correctly
 * whether or not the renderer uses a logarithmic depth buffer. Each shader's main() must be its last function.
 */
export function fxMaterial(p: THREE.ShaderMaterialParameters & { vertexShader: string; fragmentShader: string }): THREE.ShaderMaterial {
  const vEnd = p.vertexShader.lastIndexOf('}');
  const vertexShader = `#include <common>\n#include <logdepthbuf_pars_vertex>\n${p.vertexShader.slice(0, vEnd)}\n  #include <logdepthbuf_vertex>\n}`;
  const fragmentShader = `#include <logdepthbuf_pars_fragment>\n${p.fragmentShader.replace(/void main\(\)\s*\{/, 'void main() {\n  #include <logdepthbuf_fragment>\n')}`;
  return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...p, vertexShader, fragmentShader });
}

/** Pixels per meter at 1 m distance, the factor that turns a world-space point size into gl_PointSize. */
export function pointScale(camera: THREE.Camera): number {
  const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 60;
  return (window.innerHeight * Math.min(devicePixelRatio, 2)) / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
}
