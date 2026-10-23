import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface SweepSection {
  rx: number; // half width (along the frame's binormal)
  ry: number; // half height (along the frame's normal)
}
export interface SweepOptions {
  curve: THREE.Curve<THREE.Vector3>;
  segments: number;
  radial: number;
  profile: (t: number) => SweepSection;
  up?: THREE.Vector3; // normal direction at the start, transported along the curve
  capEnd?: boolean;
  /** Per-vertex color, or omit for white. */
  color?: (t: number, angle: number) => THREE.Color;
  /** Maps (t, angle) to texture coordinates. Defaults to u = angle / 2pi, v = t. */
  uv?: (t: number, angle: number) => [number, number];
}

const tmpColor = new THREE.Color();

/** A tube swept along a curve with an elliptical cross-section whose radii vary along it. */
export function sweep(o: SweepOptions): THREE.BufferGeometry {
  const { segments: n, radial: m } = o;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const tangent = new THREE.Vector3();
  const normal = (o.up ?? new THREE.Vector3(0, 1, 0)).clone();
  const binormal = new THREE.Vector3();
  const prevTangent = new THREE.Vector3();
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const rot = new THREE.Quaternion();

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    o.curve.getPointAt(t, p);
    o.curve.getTangentAt(t, tangent).normalize();
    if (i === 0) {
      binormal.crossVectors(tangent, normal).normalize();
      normal.crossVectors(binormal, tangent).normalize();
    } else {
      const axis = new THREE.Vector3().crossVectors(prevTangent, tangent);
      if (axis.lengthSq() > 1e-12) {
        axis.normalize();
        rot.setFromAxisAngle(axis, Math.acos(THREE.MathUtils.clamp(prevTangent.dot(tangent), -1, 1)));
        normal.applyQuaternion(rot).normalize();
      }
      binormal.crossVectors(tangent, normal).normalize();
    }
    prevTangent.copy(tangent);
    const { rx, ry } = o.profile(t);
    for (let j = 0; j <= m; j++) {
      const a = (j / m) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      q.copy(p).addScaledVector(normal, c * ry).addScaledVector(binormal, s * rx);
      positions.push(q.x, q.y, q.z);
      nrm.set(0, 0, 0).addScaledVector(normal, c / Math.max(ry, 1e-4)).addScaledVector(binormal, s / Math.max(rx, 1e-4)).normalize();
      normals.push(nrm.x, nrm.y, nrm.z);
      const [u, v] = o.uv ? o.uv(t, a) : [j / m, t];
      uvs.push(u, v);
      const col = o.color ? o.color(t, a) : tmpColor.set(1, 1, 1);
      colors.push(col.r, col.g, col.b);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const a = i * (m + 1) + j;
      const b = a + m + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  if (o.capEnd) {
    const center = positions.length / 3;
    o.curve.getPointAt(1, p);
    o.curve.getTangentAt(1, tangent).normalize();
    positions.push(p.x, p.y, p.z);
    normals.push(tangent.x, tangent.y, tangent.z);
    uvs.push(0.5, 1);
    const col = o.color ? o.color(1, 0) : tmpColor.set(1, 1, 1);
    colors.push(col.r, col.g, col.b);
    const ring = n * (m + 1);
    for (let j = 0; j < m; j++) indices.push(ring + j, ring + j + 1, center);
  }
  return bufferGeometry(positions, normals, uvs, colors, indices);
}

export interface FeatherOptions {
  length: number;
  width: number;
  /** 0 = symmetric vane, 1 = shaft hugging the leading (local -x) edge. */
  asymmetry: number;
  /** Downward bend of the tip as a fraction of length. */
  droop: number;
  topColor: (s: number) => THREE.Color;
  bottomColor: THREE.Color;
  /** Maps vane coordinates (u across 0..1, s along 0..1) into the texture atlas. */
  uv: (u: number, s: number) => [number, number];
  segments?: number;
  across?: number;
}

/**
 * A single feather lying in the local XZ plane, base at the origin, shaft along +Z, upper side facing +Y.
 * Built as two single-sided sheets so the upper and lower sides can carry different colors.
 */
export function feather(o: FeatherOptions): THREE.BufferGeometry {
  const n = o.segments ?? 7;
  const m = o.across ?? 4;
  const thickness = 0.0006;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const tmp = new THREE.Vector3();

  const halfWidth = (s: number) => {
    const grow = THREE.MathUtils.smoothstep(s, 0, 0.3);
    const tip = s > 0.62 ? Math.sqrt(Math.max(0, 1 - ((s - 0.62) / 0.38) ** 2)) : 1;
    return (o.width / 2) * (0.3 + 0.7 * grow) * tip;
  };

  for (let sheet = 0; sheet < 2; sheet++) {
    const top = sheet === 0;
    const base = positions.length / 3;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const hw = halfWidth(s);
      const shaftX = -o.asymmetry * (o.width / 2) * 0.55 * s;
      const z = s * o.length;
      const sag = -o.droop * o.length * s * s;
      for (let j = 0; j <= m; j++) {
        const u = (j / m) * 2 - 1;
        const x = shaftX + u * hw;
        const camber = -0.35 * hw * u * u; // vane edges curl down away from the shaft
        const y = sag + camber - (top ? 0 : thickness);
        positions.push(x, y, z);
        tmp.set(0.7 * u, 1, 2 * o.droop * s).normalize(); // gradient of y(x, z) above
        if (!top) tmp.negate();
        normals.push(tmp.x, tmp.y, tmp.z);
        const [tu, tv] = o.uv(j / m, s);
        uvs.push(tu, tv);
        const c = top ? o.topColor(s) : o.bottomColor;
        colors.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        const a = base + i * (m + 1) + j;
        const b = a + m + 1;
        if (top) indices.push(a, b, a + 1, a + 1, b, b + 1);
        else indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  return bufferGeometry(positions, normals, uvs, colors, indices);
}

/** A UV sphere with per-vertex color from its outward direction. */
export function sphere(radius: number, widthSegments: number, heightSegments: number, color: (dir: THREE.Vector3) => THREE.Color): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    const c = color(d);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function bufferGeometry(positions: number[], normals: number[], uvs: number[], colors: number[], indices: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  return g;
}

export interface SkinInfluence {
  bone: number;
  weight: number;
}

/**
 * Attaches a geometry to the skeleton. Every vertex gets the influences returned by `weights`, which sees the
 * vertex position (in the geometry's own space). The geometry is then moved by `toRoot` into the mesh's bind space.
 */
export function skin(g: THREE.BufferGeometry, toRoot: THREE.Matrix4, weights: (p: THREE.Vector3) => SkinInfluence[]): THREE.BufferGeometry {
  const pos = g.attributes.position;
  const idx = new Float32Array(pos.count * 4);
  const w = new Float32Array(pos.count * 4);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const inf = weights(p);
    let total = 0;
    for (const x of inf) total += x.weight;
    for (let k = 0; k < 4; k++) {
      const x = inf[k];
      idx[i * 4 + k] = x ? x.bone : 0;
      w[i * 4 + k] = x ? x.weight / total : 0;
    }
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  g.applyMatrix4(toRoot);
  return g;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('macaw: geometry merge failed');
  for (const p of parts) p.dispose();
  return merged;
}
