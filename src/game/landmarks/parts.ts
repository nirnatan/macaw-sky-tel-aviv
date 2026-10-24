import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Atlas rectangle in texture space: [u0, v0, u1, v1]. */
export type UvRect = readonly [number, number, number, number];

const KEEP = new Set(['position', 'normal', 'uv', 'color']);

/**
 * Collects many small vertex-colored primitives into one geometry so a whole prop is a single draw call.
 * Untextured parts point their UVs at `blankUv` (a white texel when the material has an atlas map).
 */
export class Parts {
  private readonly list: THREE.BufferGeometry[] = [];
  constructor(private readonly blankUv: readonly [number, number] = [0.5, 0.5]) {}

  /** `color: null` keeps the geometry's own per-vertex colors. */
  add(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation | null, matrix?: THREE.Matrix4, uvRect?: UvRect): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name);
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();

    const n = g.attributes.position.count;
    if (color !== null) {
      const c = new THREE.Color(color);
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    const uvs = new Float32Array(n * 2);
    const src = g.attributes.uv;
    for (let i = 0; i < n; i++) {
      if (uvRect && src) {
        uvs[i * 2] = uvRect[0] + src.getX(i) * (uvRect[2] - uvRect[0]);
        uvs[i * 2 + 1] = uvRect[1] + src.getY(i) * (uvRect[3] - uvRect[1]);
      } else {
        uvs[i * 2] = this.blankUv[0];
        uvs[i * 2 + 1] = this.blankUv[1];
      }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.list.push(g);
    return this;
  }

  /** Axis-aligned box given by its center and size, optionally rotated about its center. */
  box(w: number, h: number, d: number, color: THREE.ColorRepresentation, x: number, y: number, z: number, rot?: THREE.Euler): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, at(x, y, z, rot));
  }

  /** Thin box spanning from a to b (posts, rails, strings, chains). */
  beam(a: THREE.Vector3, b: THREE.Vector3, thickness: number, color: THREE.ColorRepresentation): this {
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(thickness, len, thickness);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize());
    return this.add(g, color, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, ONE));
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.list);
    for (const g of this.list) g.dispose();
    this.list.length = 0;
    merged.computeBoundingSphere();
    return merged;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

export function at(x: number, y: number, z: number, rot?: THREE.Euler, scale?: THREE.Vector3): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), scale ?? ONE);
}

/** Shares `base`'s vertex data across `count` instances (attributes added by the caller drive each copy). */
export function instancedFrom(base: THREE.BufferGeometry, count: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(base.index);
  for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
  g.instanceCount = count;
  return g;
}

export interface Fabric<T extends THREE.MeshStandardMaterial> {
  readonly material: T;
  /** 0..1 how much sun shines through: 1 on a clear day, 0 at night. */
  setDaylight(k: number): void;
}

/**
 * Back faces glow softly with their own color, like sunlit fabric seen from underneath (shade sails, flags).
 * The strength is a uniform, not a literal: materials share one program through the onBeforeCompile source text.
 */
export function backlitFabric<T extends THREE.MeshStandardMaterial>(material: T, strength: number): Fabric<T> {
  const uBacklit = { value: strength };
  material.onBeforeCompile = (s) => {
    s.uniforms.uBacklit = uBacklit;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBacklit;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gl_FrontFacing ? vec3(0.0) : diffuseColor.rgb * uBacklit;');
  };
  return { material, setDaylight: (k) => { uBacklit.value = strength * k; } };
}

/** Rain-soaked look: a little darker and glossier as `wet` goes 0..1. */
export function soak(material: THREE.MeshStandardMaterial, dryRoughness: number, wet: number) {
  material.roughness = dryRoughness * (1 - 0.45 * wet);
  material.color.setScalar(1 - 0.12 * wet);
}

/** Deterministic 0..1 pseudo-random sequence, so props look the same on every load. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
