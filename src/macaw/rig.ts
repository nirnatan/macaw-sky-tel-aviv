import * as THREE from 'three';
import type { FeatherColors, Palette } from './palette';
import { feather, featherTip, merge, skin, sphere, sweep, type SkinInfluence } from './geometry';
import { atlas } from './textures';

const deg = THREE.MathUtils.DEG2RAD;
const smooth = THREE.MathUtils.smoothstep;

export interface FeatherBone {
  bone: THREE.Bone;
  spread: number; // fan angle (radians about the parent's Y) when the wing is open
  fold: number; // fan angle when the wing is folded
  flex: number; // how much the feather bends with the stroke, 0 = rigid
  order: number; // 0 at the body, 1 at the wingtip, for flutter phase
  group: 'hand' | 'arm';
}
export interface Wing {
  side: 1 | -1;
  shoulder: THREE.Bone;
  elbow: THREE.Bone;
  wrist: THREE.Bone;
  feathers: FeatherBone[];
}
export interface Leg {
  side: 1 | -1;
  hip: THREE.Bone;
  knee: THREE.Bone;
  ankle: THREE.Bone;
  toesFront: THREE.Bone;
  toesBack: THREE.Bone;
}
export interface TailFeather {
  bone: THREE.Bone;
  open: number;
  closed: number;
}
export interface Rig {
  object: THREE.Group;
  body: THREE.Bone;
  torso: THREE.Bone;
  neck: THREE.Bone;
  head: THREE.Bone;
  headRest: THREE.Vector3;
  jaw: THREE.Bone;
  eyes: THREE.Bone[];
  tailBase: THREE.Bone;
  tail: TailFeather[];
  wings: Wing[];
  wingTips: [THREE.Object3D, THREE.Object3D]; // left, right: the shaft end of the longest primary
  legs: Leg[];
  meshes: THREE.SkinnedMesh[];
  dispose(): void;
}

// Rest-pose landmarks (meters, root space: body center at the origin, facing -Z).
const HEAD_CENTER = new THREE.Vector3(0, 0.078, -0.2);
const HEAD_RADIUS = 0.044;
const NECK_BASE = new THREE.Vector3(0, 0.03, -0.14);
const SHOULDER = new THREE.Vector3(0.05, 0.036, -0.055);
const HUMERUS = 0.095;
const FOREARM = 0.105;
const HAND = 0.055;
const HIP = new THREE.Vector3(0.028, -0.024, 0.012);
const THIGH = 0.05;
const SHANK = 0.075;
const TARSUS = 0.042;
const TAIL_BASE = new THREE.Vector3(0, 0.002, 0.165);

export function buildRig(palette: Palette, map: THREE.Texture, rand: () => number): Rig {
  const object = new THREE.Group();
  const bones: THREE.Bone[] = [];
  const index = new Map<THREE.Bone, number>();
  const bone = (name: string, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Bone => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    index.set(b, bones.length);
    bones.push(b);
    return b;
  };

  const body = bone('body', object, 0, 0, 0);
  const torso = bone('torso', body, 0, 0, 0);
  const neck = bone('neck', torso, NECK_BASE.x, NECK_BASE.y, NECK_BASE.z);
  const head = bone('head', neck, 0, HEAD_CENTER.y - NECK_BASE.y, HEAD_CENTER.z - NECK_BASE.z);
  const jaw = bone('jaw', head, 0, -0.014, -0.018);
  const eyeDir = new THREE.Vector3(0.78, 0.2, -0.5).normalize();
  const eyes = [1, -1].map((s) => {
    const d = eyeDir.clone().setX(eyeDir.x * s).multiplyScalar(HEAD_RADIUS * 0.96);
    return bone(`eye${s > 0 ? 'R' : 'L'}`, head, d.x, d.y, d.z);
  });
  const tailBase = bone('tailBase', torso, TAIL_BASE.x, TAIL_BASE.y, TAIL_BASE.z);

  const wings: Wing[] = [];
  const wingTips: THREE.Object3D[] = [];
  const wingFeatherSpecs: { fb: FeatherBone; opts: FeatherSpec }[] = [];
  for (const side of [1, -1] as const) {
    const sfx = side > 0 ? 'R' : 'L';
    const shoulder = bone(`shoulder${sfx}`, torso, side * SHOULDER.x, SHOULDER.y, SHOULDER.z);
    const elbow = bone(`elbow${sfx}`, shoulder, side * HUMERUS, 0, 0);
    const wrist = bone(`wrist${sfx}`, elbow, side * FOREARM, 0, 0);
    const wing: Wing = { side, shoulder, elbow, wrist, feathers: [] };
    const parents = { shoulder, elbow, wrist };
    for (const row of wingRows(palette)) {
      for (let i = 0; i < row.count; i++) {
        const spec = row.at(i);
        const b = bone(`${row.name}${sfx}${i}`, parents[row.parent], side * spec.x, spec.y, spec.z);
        const fb: FeatherBone = {
          bone: b,
          spread: spec.spread * deg,
          fold: spec.fold * deg,
          flex: spec.flex,
          order: spec.order,
          group: row.parent === 'wrist' ? 'hand' : 'arm',
        };
        wing.feathers.push(fb);
        const opts = { ...spec, asymmetry: -side * spec.asymmetry };
        wingFeatherSpecs.push({ fb, opts });
        if (row.name === 'primary' && i === LONGEST_PRIMARY) {
          const tip = new THREE.Object3D();
          tip.name = `wingTip${sfx}`;
          tip.position.copy(featherTip(opts));
          b.add(tip);
          wingTips[side > 0 ? 1 : 0] = tip;
        }
      }
    }
    wings.push(wing);
  }

  const tail: TailFeather[] = [];
  const tailSpecs: { tf: TailFeather; opts: FeatherSpec }[] = [];
  for (let i = 0; i < 12; i++) {
    const sgn = i < 6 ? -1 : 1;
    const k = Math.abs(i - 5.5);
    const b = bone(`tail${i}`, tailBase, sgn * k * 0.0025, (5.5 - k) * 0.0006, 0);
    const tf: TailFeather = { bone: b, open: sgn * k * 6.5 * deg, closed: sgn * k * 1.1 * deg };
    tail.push(tf);
    tailSpecs.push({
      tf,
      opts: {
        x: 0, y: 0, z: 0, spread: 0, fold: 0, flex: 0, order: 0,
        length: 0.46 - (k - 0.5) * 0.052,
        width: 0.042 - (k - 0.5) * 0.002,
        asymmetry: -sgn * (0.15 + k * 0.09),
        droop: 0.05,
        colors: palette.tail,
        segments: 8,
        across: 4,
      },
    });
  }

  const legs: Leg[] = [];
  for (const side of [1, -1] as const) {
    const sfx = side > 0 ? 'R' : 'L';
    const hip = bone(`hip${sfx}`, torso, side * HIP.x, HIP.y, HIP.z);
    const knee = bone(`knee${sfx}`, hip, 0, -THIGH, 0);
    const ankle = bone(`ankle${sfx}`, knee, 0, -SHANK, 0);
    const toesFront = bone(`toesF${sfx}`, ankle, 0, -TARSUS, 0);
    const toesBack = bone(`toesB${sfx}`, ankle, 0, -TARSUS, 0);
    legs.push({ side, hip, knee, ankle, toesFront, toesBack });
  }

  object.updateMatrixWorld(true);
  const rigid = (b: THREE.Bone): ((p: THREE.Vector3) => SkinInfluence[]) => {
    const inf = [{ bone: index.get(b)!, weight: 1 }];
    return () => inf;
  };
  const plumage: THREE.BufferGeometry[] = [];
  const hard: THREE.BufferGeometry[] = [];

  // Torso and neck: one tube from the tail base up into the head, skinned across torso, neck and head bones.
  const spine = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.006, 0.168),
    new THREE.Vector3(0, 0, 0.07),
    new THREE.Vector3(0, 0.004, -0.04),
    new THREE.Vector3(0, 0.018, -0.125),
    new THREE.Vector3(0, 0.05, -0.178),
    HEAD_CENTER.clone(),
  ]);
  const torsoProfile = keyframes([
    [0, 0.011, 0.009], [0.1, 0.034, 0.03], [0.28, 0.054, 0.052], [0.46, 0.063, 0.065], [0.6, 0.06, 0.064],
    [0.72, 0.046, 0.052], [0.82, 0.03, 0.033], [0.9, 0.026, 0.027], [1, 0.03, 0.03],
  ]);
  const ti = index.get(torso)!;
  const ni = index.get(neck)!;
  const hi = index.get(head)!;
  plumage.push(skin(
    sweep({ curve: spine, segments: 44, radial: 30, profile: torsoProfile, uv: (t, a) => atlas.body(a / (Math.PI * 2), t) }),
    new THREE.Matrix4(),
    (p) => {
      const toNeck = smooth(-p.z, 0.09, 0.145);
      const toHead = smooth(-p.z, 0.15, 0.19);
      return [{ bone: ti, weight: 1 - toNeck }, { bone: ni, weight: toNeck * (1 - toHead) }, { bone: hi, weight: toHead }];
    },
  ));

  const headGeom = new THREE.SphereGeometry(HEAD_RADIUS, 32, 22);
  headGeom.scale(0.92, 1, 1.09);
  remapUv(headGeom, atlas.head);
  whiteColors(headGeom);
  plumage.push(skin(headGeom, head.matrixWorld, rigid(head)));

  for (const leg of legs) {
    const thigh = new THREE.SphereGeometry(1, 14, 10);
    thigh.scale(0.019, 0.026, 0.027);
    thigh.translate(leg.side * (HIP.x + 0.006), HIP.y - 0.014, HIP.z - 0.004);
    remapUv(thigh, atlas.bellyPatch);
    whiteColors(thigh);
    plumage.push(skin(thigh, torso.matrixWorld, rigid(torso)));
  }

  // Wing arm: a flattened tube from the shoulder to the hand, blended across the three arm bones.
  for (const wing of wings) {
    const s = wing.side;
    const start = SHOULDER.clone().setX(s * SHOULDER.x).add(new THREE.Vector3(0, 0, 0.012));
    const arm = new THREE.LineCurve3(start, start.clone().add(new THREE.Vector3(s * (HUMERUS + FOREARM + HAND), 0, 0)));
    const total = HUMERUS + FOREARM + HAND;
    const armProfile = keyframes([[0, 0.03, 0.011], [HUMERUS / total, 0.03, 0.011], [(HUMERUS + FOREARM) / total, 0.024, 0.008], [1, 0.012, 0.004]]);
    const si = index.get(wing.shoulder)!;
    const ei = index.get(wing.elbow)!;
    const wi = index.get(wing.wrist)!;
    plumage.push(skin(
      sweep({ curve: arm, segments: 20, radial: 10, profile: armProfile, uv: (t, a) => atlas.body(0.02 + 0.03 * Math.sin(a), 0.55 + 0.3 * t) }),
      new THREE.Matrix4(),
      (p) => {
        const x = Math.abs(p.x) - SHOULDER.x;
        const toElbow = smooth(x, HUMERUS - 0.02, HUMERUS + 0.02);
        const toWrist = smooth(x, HUMERUS + FOREARM - 0.02, HUMERUS + FOREARM + 0.02);
        return [{ bone: si, weight: 1 - toElbow }, { bone: ei, weight: toElbow * (1 - toWrist) }, { bone: wi, weight: toWrist }];
      },
    ));
  }

  for (const { fb, opts } of wingFeatherSpecs) plumage.push(skin(featherGeometry(opts, rand), fb.bone.matrixWorld, rigid(fb.bone)));
  for (const { tf, opts } of tailSpecs) plumage.push(skin(featherGeometry(opts, rand), tf.bone.matrixWorld, rigid(tf.bone)));

  // Rigid feathers: scapulars on the back and tail coverts, with their angle baked in.
  const rigidFeather = (parent: THREE.Bone, pos: THREE.Vector3, yaw: number, opts: FeatherSpec) => {
    const g = featherGeometry(opts, rand);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(pos));
    plumage.push(skin(g, parent.matrixWorld, rigid(parent)));
  };
  for (const side of [1, -1] as const) {
    for (let i = 0; i < 5; i++) {
      rigidFeather(torso, new THREE.Vector3(side * (0.03 + i * 0.006), 0.054 - i * 0.003, -0.075 + i * 0.02), side * (10 + i * 3) * deg, {
        ...plainSpec, length: 0.1 - i * 0.004, width: 0.03, asymmetry: -side * 0.3, droop: 0.1, colors: palette.scapular, segments: 5, across: 3,
      });
    }
  }
  for (let i = 0; i < 5; i++) {
    const k = i - 2;
    rigidFeather(tailBase, new THREE.Vector3(k * 0.011, 0.007 + (2 - Math.abs(k)) * 0.0005, -0.01), k * 5 * deg, {
      ...plainSpec, length: 0.115 - Math.abs(k) * 0.012, width: 0.03, asymmetry: -Math.sign(k) * 0.3, droop: 0.04, colors: palette.tailCovert, segments: 5, across: 3,
    });
    rigidFeather(tailBase, new THREE.Vector3(k * 0.011, -0.0075 - (2 - Math.abs(k)) * 0.0005, -0.005), k * 5 * deg, {
      ...plainSpec, length: 0.095 - Math.abs(k) * 0.01, width: 0.03, asymmetry: -Math.sign(k) * 0.3, droop: -0.03,
      colors: { base: palette.tailCovert.under, tip: palette.tailCovert.under, under: palette.tailCovert.under }, segments: 5, across: 3,
    });
  }

  // Beak, in head space. The upper mandible is a deep hook; the lower is a short blunt scoop on the jaw bone.
  const upperBeak = sweep({
    curve: new THREE.CubicBezierCurve3(new THREE.Vector3(0, 0.024, -0.034), new THREE.Vector3(0, 0.032, -0.066), new THREE.Vector3(0, 0.012, -0.082), new THREE.Vector3(0, -0.04, -0.068)),
    segments: 18, radial: 16,
    profile: keyframes([[0, 0.019, 0.024], [0.3, 0.016, 0.02], [0.6, 0.0095, 0.012], [0.85, 0.0045, 0.0055], [1, 0.001, 0.001]]),
    color: (t) => new THREE.Color(palette.upperBeak.base).lerp(new THREE.Color(palette.upperBeak.tip), smooth(t, 0.55, 0.9)),
  });
  hard.push(skin(upperBeak, head.matrixWorld, rigid(head)));
  const lowerBeak = sweep({
    curve: new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.004, -0.012), new THREE.Vector3(0, -0.009, -0.036), new THREE.Vector3(0, -0.011, -0.05)),
    segments: 8, radial: 14, capEnd: true,
    profile: keyframes([[0, 0.018, 0.012], [0.6, 0.016, 0.011], [1, 0.011, 0.008]]),
    color: () => new THREE.Color(palette.lowerBeak),
  });
  hard.push(skin(lowerBeak, jaw.matrixWorld, rigid(jaw)));

  const iris = new THREE.Color(palette.iris);
  const ring = new THREE.Color('#3a2a1a');
  const pupil = new THREE.Color('#060606');
  for (const eye of eyes) {
    const outward = eye.position.clone().normalize();
    const g = sphere(0.0092, 28, 18, (d) => {
      const a = d.angleTo(outward);
      return a < 0.46 ? pupil : a < 0.52 ? ring : iris;
    });
    hard.push(skin(g, eye.matrixWorld, rigid(eye)));
  }

  const legColor = new THREE.Color(palette.legs);
  const clawColor = new THREE.Color('#2a2624');
  const Z = new THREE.Vector3(0, 0, 1);
  for (const leg of legs) {
    const s = leg.side;
    hard.push(skin(sweep({
      curve: new THREE.LineCurve3(new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(0, -SHANK, 0)), segments: 6, radial: 10, up: Z,
      profile: keyframes([[0, 0.012, 0.012], [0.7, 0.0075, 0.0075], [1, 0.0065, 0.0065]]), color: () => legColor,
    }), leg.knee.matrixWorld, rigid(leg.knee)));
    hard.push(skin(sweep({
      curve: new THREE.LineCurve3(new THREE.Vector3(0, 0.004, 0), new THREE.Vector3(0, -TARSUS, 0)), segments: 6, radial: 10, up: Z,
      profile: (t) => ({ rx: 0.0068 * (1 + 0.08 * Math.sin(t * 9)), ry: 0.0068 * (1 + 0.08 * Math.sin(t * 9)) }), color: () => legColor,
    }), leg.ankle.matrixWorld, rigid(leg.ankle)));
    const toes: [THREE.Bone, number, number][] = [
      [leg.toesFront, -1, 0.044], [leg.toesFront, 1, 0.036], [leg.toesBack, 1, 0.03], [leg.toesBack, -1, 0.022],
    ];
    toes.forEach(([toeBone, inner, length], k) => { // zygodactyl: toes II and III forward, I and IV back, each pair splayed
      const forward = k < 2 ? -1 : 1;
      const angle = (k < 2 ? 15 : 22) * deg * inner * s * forward;
      const dir = new THREE.Vector3(Math.sin(angle), 0, forward * Math.cos(angle));
      const end = dir.clone().multiplyScalar(length).setY(-0.004);
      const toe = sweep({
        curve: new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(length * 0.5).setY(0.005), end),
        segments: 6, radial: 8, up: new THREE.Vector3(0, 1, 0),
        profile: (t) => { const r = 0.0048 * (1 - 0.3 * t) * (1 + 0.14 * Math.sin(t * Math.PI * 3)); return { rx: r, ry: r * 0.85 }; },
        color: () => legColor,
      });
      const claw = sweep({
        curve: new THREE.QuadraticBezierCurve3(end.clone(), end.clone().addScaledVector(dir, 0.009).setY(-0.004), end.clone().addScaledVector(dir, 0.013).setY(-0.011)),
        segments: 4, radial: 7, up: new THREE.Vector3(0, 1, 0),
        profile: keyframes([[0, 0.0032, 0.0032], [1, 0.0005, 0.0005]]), color: () => clawColor,
      });
      hard.push(skin(merge([toe, claw]), toeBone.matrixWorld, rigid(toeBone)));
    });
  }

  const skeleton = new THREE.Skeleton(bones);
  const plumageMaterial = new THREE.MeshPhysicalMaterial({
    map, vertexColors: true, roughness: 0.75, metalness: 0, sheen: 0.5, sheenRoughness: 0.65, sheenColorMap: map,
  });
  const hardMaterial = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.38, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25,
  });
  const meshes = [new THREE.SkinnedMesh(merge(plumage), plumageMaterial), new THREE.SkinnedMesh(merge(hard), hardMaterial)];
  for (const m of meshes) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    object.add(m);
    m.bind(skeleton);
  }

  return {
    object, body, torso, neck, head, headRest: head.position.clone(), jaw, eyes, tailBase, tail, wings,
    wingTips: [wingTips[0], wingTips[1]], legs, meshes,
    dispose() {
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      map.dispose();
    },
  };
}

interface FeatherSpec {
  x: number;
  y: number;
  z: number;
  spread: number; // degrees
  fold: number; // degrees
  flex: number;
  order: number;
  length: number;
  width: number;
  asymmetry: number;
  droop: number;
  colors: FeatherColors;
  segments: number;
  across: number;
}
const plainSpec = { x: 0, y: 0, z: 0, spread: 0, fold: 0, flex: 0, order: 0 };

interface FeatherRow {
  name: string;
  parent: 'shoulder' | 'elbow' | 'wrist';
  count: number;
  at: (i: number) => FeatherSpec;
}

const PRIMARY_LENGTHS = [0.17, 0.19, 0.21, 0.225, 0.235, 0.24, 0.24, 0.232, 0.222, 0.208];
const LONGEST_PRIMARY = PRIMARY_LENGTHS.indexOf(Math.max(...PRIMARY_LENGTHS));

/** Feather rows per wing, innermost feather first. Angles: 90 = along the bone (outward), 0 = straight back. */
function wingRows(p: Palette): FeatherRow[] {
  const big = { segments: 7, across: 4 };
  const mid = { segments: 5, across: 3 };
  const small = { segments: 4, across: 2 };
  const primary = (i: number) => ({ x: 0.004 + i * 0.0055, y: (9 - i) * 0.0005, spread: 28 + i * 7.4 });
  const secondary = (i: number) => ({ x: 0.1 - i * 0.0085, y: 0.0055 + i * 0.0005, spread: 22 - i * 1.4 });
  return [
    { name: 'primary', parent: 'wrist', count: 10, at: (i) => ({ ...primary(i), z: 0, fold: 90 + (9 - i) * 0.6, flex: 0.4 + 0.06 * i, order: 0.6 + 0.4 * i / 9, length: PRIMARY_LENGTHS[i], width: 0.036 - i * 0.0009, asymmetry: 0.55 + 0.03 * i, droop: 0.06, colors: p.primary, ...big }) },
    { name: 'primaryCovert', parent: 'wrist', count: 10, at: (i) => ({ ...primary(i), y: primary(i).y + 0.0025, z: -0.004, spread: primary(i).spread - 3, fold: 91, flex: 0.25, order: 0.6 + 0.4 * i / 9, length: 0.09 - i * 0.002, width: 0.027, asymmetry: 0.5, droop: 0.05, colors: p.primaryCovert, ...mid }) },
    { name: 'alula', parent: 'wrist', count: 3, at: (i) => ({ x: -0.004 + i * 0.004, y: 0.012, z: -0.012, spread: 62 + i * 8, fold: 92, flex: 0.1, order: 0.6, length: 0.05 - i * 0.005, width: 0.017, asymmetry: 0.5, droop: 0.05, colors: p.primaryCovert, ...small }) },
    { name: 'secondary', parent: 'elbow', count: 12, at: (i) => ({ ...secondary(i), z: 0.004, fold: -111 + i * 0.5, flex: 0.2 - i * 0.012, order: 0.55 - 0.3 * i / 11, length: 0.16 - i * 0.003, width: 0.036, asymmetry: 0.4, droop: 0.05, colors: p.secondary, ...big }) },
    { name: 'greaterCovert', parent: 'elbow', count: 12, at: (i) => ({ ...secondary(i), y: secondary(i).y + 0.0025, z: -0.004, spread: secondary(i).spread + 2, fold: -110, flex: 0.1, order: 0.55 - 0.3 * i / 11, length: 0.085 - i * 0.0015, width: 0.027, asymmetry: 0.4, droop: 0.05, colors: p.greaterCovert, ...mid }) },
    { name: 'medianCovert', parent: 'elbow', count: 12, at: (i) => ({ ...secondary(i), x: secondary(i).x + 0.003, y: secondary(i).y + 0.005, z: -0.013, spread: secondary(i).spread + 4, fold: -109, flex: 0.05, order: 0.5, length: 0.052, width: 0.02, asymmetry: 0.4, droop: 0.06, colors: p.medianCovert, ...small }) },
    { name: 'lesserCovert', parent: 'elbow', count: 9, at: (i) => ({ x: 0.1 - i * 0.012, y: 0.0115 + i * 0.0004, z: -0.022, spread: 28 - i, fold: -108, flex: 0, order: 0.5, length: 0.03, width: 0.015, asymmetry: 0.4, droop: 0.08, colors: p.lesserCovert, ...small }) },
    { name: 'tertial', parent: 'shoulder', count: 6, at: (i) => ({ x: 0.02 + i * 0.014, y: 0.011 - i * 0.0005, z: 0.006, spread: 4 + i, fold: 69 - i * 0.5, flex: 0.08, order: 0.25, length: 0.125 - i * 0.004, width: 0.034, asymmetry: 0.3, droop: 0.05, colors: p.secondary, ...mid }) },
    { name: 'humeralCovert', parent: 'shoulder', count: 6, at: (i) => ({ x: 0.023 + i * 0.014, y: 0.0145 - i * 0.0005, z: -0.006, spread: 6 + i, fold: 68, flex: 0.03, order: 0.25, length: 0.07 - i * 0.003, width: 0.026, asymmetry: 0.3, droop: 0.06, colors: p.greaterCovert, ...small }) },
    { name: 'humeralLesser', parent: 'shoulder', count: 6, at: (i) => ({ x: 0.015 + i * 0.014, y: 0.0175, z: -0.02, spread: 8 + i, fold: 67, flex: 0, order: 0.25, length: 0.035, width: 0.016, asymmetry: 0.3, droop: 0.08, colors: p.lesserCovert, ...small }) },
  ];
}

const c1 = new THREE.Color();
const c2 = new THREE.Color();

function featherGeometry(o: FeatherSpec, rand: () => number): THREE.BufferGeometry {
  const jitter = 1 + (rand() - 0.5) * 0.12;
  const hue = (rand() - 0.5) * 0.01;
  const vary = (hex: string) => {
    const c = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    return c.setHSL(hsl.h + hue, hsl.s, THREE.MathUtils.clamp(hsl.l * jitter, 0, 1));
  };
  const base = vary(o.colors.base);
  const tip = vary(o.colors.tip);
  const under = vary(o.colors.under);
  return feather({
    length: o.length,
    width: o.width,
    asymmetry: o.asymmetry,
    droop: o.droop,
    topColor: (s) => c1.copy(base).lerp(c2.copy(tip), smooth(s, 0.5, 0.85)),
    bottomColor: under,
    uv: atlas.feather,
    segments: o.segments,
    across: o.across,
  });
}

function keyframes(keys: [t: number, rx: number, ry: number][]): (t: number) => { rx: number; ry: number } {
  return (t) => {
    let i = 1;
    while (i < keys.length - 1 && keys[i][0] < t) i++;
    const [t0, rx0, ry0] = keys[i - 1];
    const [t1, rx1, ry1] = keys[i];
    const f = smooth(t, t0, t1);
    return { rx: THREE.MathUtils.lerp(rx0, rx1, f), ry: THREE.MathUtils.lerp(ry0, ry1, f) };
  };
}

function remapUv(g: THREE.BufferGeometry, fn: (u: number, v: number) => [number, number]): void {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const [u, v] = fn(uv.getX(i), uv.getY(i));
    uv.setXY(i, u, v);
  }
}

function whiteColors(g: THREE.BufferGeometry): void {
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
}
