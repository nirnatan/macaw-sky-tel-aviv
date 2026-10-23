import * as THREE from 'three';
import type { MacawMode } from '../contracts';

const lerp = THREE.MathUtils.lerp;
const TAU = Math.PI * 2;

/**
 * Every animated degree of freedom, as a flat record so modes can be blended channel by channel.
 * Angles in radians, offsets in meters, spreads 0..1. Wing channels are symmetric; bank asymmetry is added by the rig.
 */
export const POSE_CHANNELS = [
  'bodyPitch', 'bodyRoll', 'bodyYaw', 'bodyX', 'bodyY', 'bodyZ', 'breathe',
  'neckPitch', 'headPitch', 'headYaw', 'headRoll', 'headZ',
  'sweep', 'lift', 'twist', 'elbow', 'wrist', 'wristPitch', 'handSpread', 'armSpread', 'primaryBend', 'flutter',
  'tailSpread', 'tailPitch', 'tailRoll',
  'hipL', 'kneeL', 'ankleL', 'toesL', 'hipR', 'kneeR', 'ankleR', 'toesR', 'legSplay',
  'beakOpen',
] as const;
export type Pose = Record<(typeof POSE_CHANNELS)[number], number>;

export function emptyPose(): Pose {
  const p = {} as Pose;
  for (const k of POSE_CHANNELS) p[k] = 0;
  return p;
}

export function blendPoses(out: Pose, poses: Pose[], weights: number[]): void {
  for (const k of POSE_CHANNELS) {
    let v = 0;
    for (let i = 0; i < poses.length; i++) v += poses[i][k] * weights[i];
    out[k] = v;
  }
}

export interface AnimContext {
  t: number; // seconds since creation
  flapPhase: number; // radians, unwrapped
  walkPhase: number; // radians, unwrapped; one full cycle = two steps
  effort: number;
  walkSpeed: number;
}
export type ModeFn = (c: AnimContext, p: Pose) => void;

/** Flap rate in Hz for a mode, before smoothing. Quiet modes keep a slow phase so a crossfade into flap starts moving. */
export function flapRate(mode: MacawMode, effort: number): number {
  switch (mode) {
    case 'flap': return 4 + 2 * effort;
    case 'hover': return 6.5 + 1.5 * effort;
    case 'land': return 3.5;
    default: return 1.2;
  }
}

const SPREAD_WING = { sweep: 0, lift: 0.1, twist: 0.06, elbow: 0.12, wrist: 0.05, wristPitch: 0, handSpread: 1, armSpread: 1 };
// Solved so the elbow sits on the flank and the wrist at the shoulder front; lift raised afterwards so the primaries cross just above the tail base.
const FOLDED_WING = { sweep: 1.433, lift: -0.3, twist: -1.124, elbow: 3.147, wrist: 3.663, wristPitch: -0.055, handSpread: 0, armSpread: 0 };
type WingJoints = keyof typeof SPREAD_WING;

function foldWing(p: Pose, fold: number): void {
  for (const k of Object.keys(SPREAD_WING) as WingJoints[]) p[k] = lerp(SPREAD_WING[k], FOLDED_WING[k], fold);
}

const TUCKED_LEGS = { hip: 1.5, knee: 2.9, ankle: 0.15, toes: 1.35 }; // toes fold along the tarsus into a fist under the tail
const STANDING_LEGS = { hip: 0.85, knee: 2.0, ankle: 1.15, toes: 0.05 };
const REACHING_LEGS = { hip: 1.15, knee: 1.1, ankle: 0.5, toes: -0.3 };
type LegJoints = { hip: number; knee: number; ankle: number; toes: number };

function setLeg(p: Pose, side: 'L' | 'R', j: LegJoints): void {
  p[`hip${side}`] = j.hip;
  p[`knee${side}`] = j.knee;
  p[`ankle${side}`] = j.ankle;
  p[`toes${side}`] = j.toes;
}
function setLegs(p: Pose, j: LegJoints): void {
  setLeg(p, 'L', j);
  setLeg(p, 'R', j);
}

/** Wing stroke: a fast, fully extended downstroke and a slower upstroke with the wrist folding in. */
function flapWing(p: Pose, phase: number, amp: number): void {
  const liftAt = (ph: number) => {
    const q = ((ph % TAU) + TAU) % TAU / TAU;
    const top = 0.95 * amp;
    const bottom = -0.7 * amp;
    const down = 0.42;
    const s = q < down ? q / down : 1 - (q - down) / (1 - down);
    return lerp(top, bottom, 0.5 - 0.5 * Math.cos(Math.PI * s));
  };
  const lift = liftAt(phase);
  const liftVel = (liftAt(phase + 0.05) - liftAt(phase - 0.05)) / 0.1; // per radian of phase
  const q = ((phase % TAU) + TAU) % TAU / TAU;
  const up = q < 0.42 ? 0 : Math.sin(Math.PI * (q - 0.42) / 0.58);
  p.lift = lift;
  p.twist = 0.1 - 0.22 * liftVel * 0.5 * amp;
  p.elbow = 0.15 + 0.6 * up * amp;
  p.wrist = 0.05 + 0.9 * up * amp;
  p.wristPitch = -0.25 * up * amp;
  p.handSpread = 1 - 0.45 * up * amp;
  p.armSpread = 1 - 0.2 * up * amp;
  p.primaryBend = -0.28 * liftVel * amp;
  p.bodyY = -0.006 * lift;
}

const modeFlap: ModeFn = (c, p) => {
  const amp = 0.5 + 0.5 * c.effort;
  foldWing(p, 0);
  flapWing(p, c.flapPhase, amp);
  p.sweep = -0.05;
  p.bodyPitch = 0.05 + 0.1 * c.effort;
  p.neckPitch = -0.1;
  p.headPitch = -0.1 * c.effort;
  p.tailSpread = 0.3 + 0.3 * c.effort;
  p.tailPitch = -0.05;
  setLegs(p, TUCKED_LEGS);
};

const modeGlide: ModeFn = (c, p) => {
  foldWing(p, 0);
  p.lift = 0.14 + 0.03 * Math.sin(c.t * 1.3);
  p.twist = 0.08;
  p.elbow = 0.1;
  p.flutter = 0.05;
  p.bodyPitch = 0.02;
  p.neckPitch = -0.1;
  p.tailSpread = 0.35;
  p.tailPitch = 0.02;
  setLegs(p, TUCKED_LEGS);
};

const modeDive: ModeFn = (_c, p) => {
  foldWing(p, 0.45);
  p.lift = -0.12;
  p.twist = -0.1;
  p.sweep = 0.75;
  p.elbow = 0.9;
  p.wrist = 1.1;
  p.handSpread = 0.55;
  p.armSpread = 0.7;
  p.bodyPitch = -0.05;
  p.neckPitch = -0.2;
  p.headPitch = 0.05;
  p.tailSpread = 0.05;
  setLegs(p, TUCKED_LEGS);
};

const modeHover: ModeFn = (c, p) => {
  foldWing(p, 0);
  flapWing(p, c.flapPhase, 1.1);
  p.sweep = -0.15;
  p.bodyPitch = 0.75;
  p.bodyY += 0.01;
  p.neckPitch = -0.35;
  p.headPitch = -0.4;
  p.tailSpread = 0.85;
  p.tailPitch = -0.6;
  setLegs(p, { hip: 0.9, knee: 1.9, ankle: 1.2, toes: 0.6 });
};

const modeLand: ModeFn = (c, p) => {
  foldWing(p, 0);
  flapWing(p, c.flapPhase, 0.55);
  p.lift += 0.25;
  p.sweep = -0.35;
  p.twist += 0.55;
  p.handSpread = 1;
  p.armSpread = 1;
  p.bodyPitch = 0.6;
  p.neckPitch = -0.3;
  p.headPitch = -0.35;
  p.tailSpread = 1;
  p.tailPitch = -0.7;
  setLegs(p, REACHING_LEGS);
  p.legSplay = 0.15;
};

export const WALK_STRIDE = 0.11; // meters per step

const modeWalk: ModeFn = (c, p) => {
  const gait = THREE.MathUtils.clamp(c.walkSpeed / 0.2, 0, 1); // fades the cycle out when standing still
  const ph = c.walkPhase;
  foldWing(p, 1);
  p.bodyPitch = 0.38;
  p.bodyRoll = -0.12 * gait * Math.sin(ph);
  p.bodyYaw = 0.07 * gait * Math.sin(ph);
  p.bodyX = 0.012 * gait * Math.sin(ph);
  p.bodyY = 0.004 * gait * Math.abs(Math.cos(ph));
  p.neckPitch = -0.25;
  p.headPitch = -0.3;
  p.headZ = 0.012 * gait * Math.max(0, Math.sin(2 * ph + 0.6));
  p.headRoll = 0.04 * gait * Math.sin(ph);
  p.tailSpread = 0.1;
  p.tailPitch = 0.08 + 0.03 * gait * Math.sin(ph);
  p.legSplay = 0.1;
  for (const [side, offset] of [['L', 0], ['R', Math.PI]] as const) {
    const swing = Math.max(0, Math.sin(ph + offset)); // 1 mid-swing, 0 on the ground
    const hip = STANDING_LEGS.hip + 0.5 * gait * Math.cos(ph + offset);
    setLeg(p, side, {
      hip,
      knee: STANDING_LEGS.knee + 0.6 * gait * swing,
      ankle: STANDING_LEGS.ankle + 0.5 * gait * swing,
      toes: 0.05 + 0.5 * gait * swing,
    });
  }
};

const modeIdle: ModeFn = (c, p) => {
  foldWing(p, 1);
  p.bodyPitch = 0.65; // perched macaws stand tall, tail angled down behind
  p.breathe = Math.sin(c.t * TAU * 0.45);
  p.neckPitch = -0.45;
  p.headPitch = -0.35;
  p.tailSpread = 0.06;
  p.tailPitch = 0.25;
  p.legSplay = 0.1;
  setLegs(p, STANDING_LEGS);
};

export const MODES: Record<MacawMode, ModeFn> = {
  flap: modeFlap,
  glide: modeGlide,
  dive: modeDive,
  hover: modeHover,
  land: modeLand,
  walk: modeWalk,
  idle: modeIdle,
};
export const MODE_LIST = Object.keys(MODES) as MacawMode[];
