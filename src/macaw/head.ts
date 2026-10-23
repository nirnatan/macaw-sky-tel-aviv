import * as THREE from 'three';
import type { Palette } from './palette';
import { keyframes, sphere, sweep } from './geometry';
import { atlas, FACE } from './textures';

const TAU = Math.PI * 2;
const smooth = THREE.MathUtils.smoothstep;

// Head space: the head bone sits at the skull center and faces -Z. The skull is a tube that starts inside the neck,
// widens into a flat crown and full cheeks, and narrows to the cere; its profile keys are arc-length fractions.
const SKULL_SPINE = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, -0.033, 0.04),
  new THREE.Vector3(0, -0.016, 0.026),
  new THREE.Vector3(0, -0.006, 0.008),
  new THREE.Vector3(0, -0.005, -0.014),
  new THREE.Vector3(0, -0.003, -0.034),
  new THREE.Vector3(0, 0, -0.05),
  new THREE.Vector3(0, 0.003, -0.061),
]);
const SKULL_PROFILE = keyframes([
  [0, 0.016, 0.016], [0.15, 0.029, 0.029], [0.35, 0.039, 0.038], [0.55, 0.041, 0.039], [0.75, 0.037, 0.035], [0.9, 0.027, 0.027], [1, 0.018, 0.019],
]);
export const EYE_RADIUS = 0.0072;
const NOSTRIL_ANGLE = 2 * (TAU / 24); // two radial steps off the culmen, so the dot lands on vertices
export const JAW_PIVOT = new THREE.Vector3(0, -0.02, -0.036);

export function skullGeometry(): THREE.BufferGeometry {
  return sweep({ curve: SKULL_SPINE, segments: 36, radial: 32, profile: SKULL_PROFILE, uv: (t, a) => atlas.head(a / TAU, t) });
}

/** A point on the skull surface at arc fraction t and angle a from the crown (positive toward the bird's right). */
function skullSurface(t: number, a: number, inset = 1): THREE.Vector3 {
  const p = SKULL_SPINE.getPointAt(t);
  const tangent = SKULL_SPINE.getTangentAt(t).normalize();
  const normal = new THREE.Vector3(0, 1, 0).addScaledVector(tangent, -tangent.y).normalize(); // the spine is planar, so this is the transported frame
  const binormal = new THREE.Vector3().crossVectors(tangent, normal);
  const { rx, ry } = SKULL_PROFILE(t);
  return p.addScaledVector(normal, Math.cos(a) * ry * inset).addScaledVector(binormal, Math.sin(a) * rx * inset);
}

/** Eye centers in head space, left then right, sunk slightly into the skull so the lids read as a rim. */
export function eyeCenters(): [THREE.Vector3, THREE.Vector3] {
  return [skullSurface(FACE.eye.t, -FACE.eye.angle, 0.92), skullSurface(FACE.eye.t, FACE.eye.angle, 0.92)];
}

export function eyeGeometry(palette: Palette, center: THREE.Vector3): THREE.BufferGeometry {
  const outward = center.clone().sub(SKULL_SPINE.getPointAt(FACE.eye.t)).normalize();
  const iris = new THREE.Color(palette.iris);
  const irisEdge = iris.clone().multiplyScalar(0.72);
  const pupil = new THREE.Color('#050505');
  const out = new THREE.Color();
  return sphere(EYE_RADIUS, 28, 18, (d) => {
    const a = d.angleTo(outward);
    if (a < 0.5) return out.copy(pupil);
    if (a < 0.56) return out.copy(pupil).lerp(irisEdge, (a - 0.5) / 0.06);
    return out.copy(irisEdge).lerp(iris, smooth(a, 0.56, 0.85));
  });
}

const c1 = new THREE.Color();
const c2 = new THREE.Color();

/** Faint growth rings across the keratin, perpendicular to the growth direction. */
function striations(t: number): number {
  return 1 - 0.035 * (0.5 + 0.5 * Math.sin(t * 95)) * smooth(t, 0.08, 0.3);
}

/** The upper mandible in head space: a cere at the base with a nostril each side, then a deep hook. */
export function upperBeakGeometry(palette: Palette): THREE.BufferGeometry {
  const cere = new THREE.Color(palette.cere);
  const nostril = new THREE.Color('#141010');
  const base = new THREE.Color(palette.upperBeak.base);
  const tip = new THREE.Color(palette.upperBeak.tip);
  const edge = new THREE.Color(palette.upperBeak.edge);
  return sweep({
    curve: new THREE.CubicBezierCurve3(new THREE.Vector3(0, 0.01, -0.047), new THREE.Vector3(0, 0.027, -0.081), new THREE.Vector3(0, 0.004, -0.099), new THREE.Vector3(0, -0.041, -0.083)),
    segments: 40, radial: 24,
    profile: keyframes([[0, 0.0165, 0.019], [0.12, 0.0175, 0.021], [0.45, 0.013, 0.016], [0.7, 0.0082, 0.0105], [0.9, 0.0036, 0.0045], [1, 0.0008, 0.0008]]),
    color: (t, a) => {
      const side = Math.abs(Math.sin(a)); // 0 on the culmen and under the hook, 1 on the sides
      const under = 0.5 - 0.5 * Math.cos(a); // 0 at the culmen, 1 underneath
      c1.copy(base).lerp(edge, smooth(side, 0.55, 0.95) * (1 - smooth(t, 0.35, 0.6)) * under);
      c1.lerp(tip, smooth(t, 0.6, 0.92)).multiplyScalar(striations(t));
      c1.lerp(cere, 1 - smooth(t, 0.055, 0.085));
      const da = Math.min(Math.abs(a - NOSTRIL_ANGLE), Math.abs(a - (TAU - NOSTRIL_ANGLE)));
      const nose = Math.hypot((t - 0.05) * 0.08, da * 0.018); // metric distance to the nearest nostril
      return c1.lerp(nostril, 1 - smooth(nose, 0.002, 0.0034));
    },
  });
}

/** The lower mandible in jaw space: a broad scoop that the upper hook closes over. */
export function lowerBeakGeometry(palette: Palette): THREE.BufferGeometry {
  const col = new THREE.Color(palette.lowerBeak);
  return sweep({
    curve: new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.004, 0.012), new THREE.Vector3(0, -0.004, -0.018), new THREE.Vector3(0, -0.009, -0.044)),
    segments: 14, radial: 16, capEnd: true,
    profile: keyframes([[0, 0.016, 0.011], [0.5, 0.0155, 0.0115], [1, 0.011, 0.008]]),
    color: (t) => c2.copy(col).multiplyScalar(striations(t)),
  });
}
