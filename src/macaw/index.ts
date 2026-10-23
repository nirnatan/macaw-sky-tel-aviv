import * as THREE from 'three';
import type { CreateMacaw, Macaw, MacawAnimInput, MacawMode } from '../contracts';
import { PALETTES } from './palette';
import { createAtlas, mulberry32 } from './textures';
import { buildRig, type Rig } from './rig';
import { MODES, MODE_LIST, WALK_STRIDE, blendPoses, emptyPose, flapRate, type AnimContext, type Pose } from './pose';

const TAU = Math.PI * 2;
const lerp = THREE.MathUtils.lerp;

/** Critically damped spring toward a target (Unity's SmoothDamp). */
class Spring {
  v = 0;
  constructor(public x: number, private smoothTime: number) {}
  to(target: number, dt: number): number {
    const omega = 2 / this.smoothTime;
    const k = omega * dt;
    const decay = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
    const delta = this.x - target;
    const temp = (this.v + omega * delta) * dt;
    this.v = (this.v - omega * temp) * decay;
    this.x = target + (delta + temp) * decay;
    return this.x;
  }
}

/** Random one-shot gestures that run on top of every mode. */
class Gestures {
  blink = 0;
  tilt = 0;
  squawk = 0;
  private nextBlink = 2;
  private blinkT = 1;
  private nextTilt = 4;
  private tiltT = 1;
  private tiltDir = 1;
  private squawkT = 1;

  update(dt: number, rand: () => number): void {
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.nextBlink = 1.5 + rand() * 4;
      this.blinkT = 0;
    }
    this.blinkT = Math.min(1, this.blinkT + dt / 0.16);
    this.blink = Math.sin(this.blinkT * Math.PI);

    this.nextTilt -= dt;
    if (this.nextTilt <= 0) {
      this.nextTilt = 3 + rand() * 5;
      this.tiltT = 0;
      this.tiltDir = rand() < 0.5 ? -1 : 1;
    }
    this.tiltT = Math.min(1, this.tiltT + dt / 1.6);
    this.tilt = this.tiltDir * 0.35 * Math.sin(this.tiltT * Math.PI) ** 0.5;

    this.squawkT = Math.min(1, this.squawkT + dt / 0.55);
    this.squawk = Math.sin(this.squawkT * Math.PI) ** 0.7;
  }
  startSquawk(): void {
    this.squawkT = 0;
  }
}

export const createMacaw: CreateMacaw = (species) => new MacawImpl(species);

class MacawImpl implements Macaw {
  readonly object: THREE.Group;
  readonly footOffset: number;
  private rig: Rig;
  private rand: () => number;
  private time = 0;
  private flapPhase = 0;
  private walkPhase = 0;
  private flapRateSpring = new Spring(flapRate('idle', 0), 0.3);
  private weights: Record<MacawMode, Spring>;
  private modePoses: Record<MacawMode, Pose>;
  private pose = emptyPose();
  private effort = new Spring(0.4, 0.2);
  private bank = new Spring(0, 0.18);
  private pitch = new Spring(0, 0.2);
  private look = new Spring(0, 0.25);
  private walkSpeed = new Spring(0, 0.2);
  private gestures = new Gestures();

  constructor(species: 'blueGold' | 'scarlet') {
    this.rand = mulberry32(species === 'blueGold' ? 11 : 23);
    const palette = PALETTES[species];
    this.rig = buildRig(palette, createAtlas(palette, species === 'blueGold' ? 7 : 19), this.rand);
    this.object = this.rig.object;
    this.weights = Object.fromEntries(MODE_LIST.map((m) => [m, new Spring(m === 'idle' ? 1 : 0, 0.28)])) as Record<MacawMode, Spring>;
    this.modePoses = Object.fromEntries(MODE_LIST.map((m) => [m, emptyPose()])) as Record<MacawMode, Pose>;

    this.update(0, { mode: 'idle', effort: 0, bank: 0, pitch: 0, walkSpeed: 0, look: 0 });
    this.object.updateMatrixWorld(true);
    const foot = new THREE.Vector3();
    let lowest = 0;
    for (const leg of this.rig.legs) lowest = Math.min(lowest, leg.toesFront.getWorldPosition(foot).y);
    this.footOffset = -lowest + 0.005;
  }

  update(dt: number, input: MacawAnimInput): void {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const effort = this.effort.to(THREE.MathUtils.clamp(input.effort, 0, 1), dt);
    const bank = this.bank.to(input.bank, dt);
    const pitch = this.pitch.to(input.pitch, dt);
    const look = this.look.to(THREE.MathUtils.clamp(input.look, -1, 1), dt);
    const walkSpeed = this.walkSpeed.to(Math.max(0, input.walkSpeed), dt);

    this.flapPhase += dt * TAU * this.flapRateSpring.to(flapRate(input.mode, effort), dt);
    this.walkPhase += dt * TAU * (walkSpeed / (2 * WALK_STRIDE));
    this.gestures.update(dt, this.rand);

    const ctx: AnimContext = { t: this.time, flapPhase: this.flapPhase, walkPhase: this.walkPhase, effort, walkSpeed };
    const active: Pose[] = [];
    const weights: number[] = [];
    let total = 0;
    for (const m of MODE_LIST) {
      const w = this.weights[m].to(m === input.mode ? 1 : 0, dt);
      if (w < 0.002) continue;
      MODES[m](ctx, this.modePoses[m]);
      active.push(this.modePoses[m]);
      weights.push(w);
      total += w;
    }
    blendPoses(this.pose, active, weights.map((w) => w / total));

    const p = this.pose;
    const g = this.gestures;
    p.bodyPitch += 0.3 * pitch;
    p.headPitch += -0.4 * pitch + 0.35 * g.squawk;
    p.neckPitch += 0.25 * g.squawk;
    p.headZ += 0.012 * g.squawk;
    p.tailPitch += -0.3 * pitch;
    p.headRoll += g.tilt - 0.4 * bank;
    p.headYaw += 0.75 * look;
    p.tailRoll += 0.5 * bank;
    p.tailSpread = Math.min(1, p.tailSpread + 0.3 * Math.abs(bank));
    p.beakOpen += g.squawk;
    this.apply(p, bank, look, g.blink);
  }

  squawk(): void {
    this.gestures.startSquawk();
  }

  dispose(): void {
    this.rig.dispose();
  }

  private apply(p: Pose, bank: number, look: number, blink: number): void {
    const r = this.rig;
    r.body.position.set(p.bodyX, p.bodyY, p.bodyZ);
    r.body.rotation.set(p.bodyPitch, p.bodyYaw, p.bodyRoll);
    const breathe = 1 + 0.02 * p.breathe;
    r.torso.scale.set(1 + 0.5 * (breathe - 1), breathe, 1 + 0.5 * (breathe - 1));
    r.neck.rotation.set(p.neckPitch, 0.3 * look, 0);
    r.head.rotation.set(p.headPitch, p.headYaw, p.headRoll, 'YXZ');
    r.head.position.set(r.headRest.x, r.headRest.y, r.headRest.z - p.headZ);
    r.jaw.rotation.x = -0.5 * THREE.MathUtils.clamp(p.beakOpen, 0, 1);
    for (const eye of r.eyes) eye.scale.y = 1 - 0.92 * blink;

    for (const wing of r.wings) {
      const s = wing.side;
      const inner = Math.max(0, s * bank); // the lowered wing on a banked turn tucks a little
      const lift = p.lift - 0.35 * s * bank;
      wing.shoulder.rotation.set(s * (p.twist + 0.15 * inner), -s * p.sweep, s * lift, 'YZX');
      wing.elbow.rotation.y = s * (p.elbow + 0.3 * inner);
      wing.wrist.rotation.set(0, -s * (p.wrist + 0.25 * inner), s * p.wristPitch, 'YZX');
      for (const f of wing.feathers) {
        const spread = f.group === 'hand' ? p.handSpread : p.armSpread;
        const angle = lerp(f.fold, f.spread, spread);
        const flutter = p.flutter * Math.sin(this.time * TAU * 9 + f.order * 7) * f.order;
        const bend = f.flex * (p.primaryBend * f.order + flutter);
        f.bone.rotation.set(-bend, s * angle, 0, 'YXZ');
      }
    }

    r.tailBase.rotation.set(-p.tailPitch, 0, p.tailRoll);
    for (const t of r.tail) t.bone.rotation.y = lerp(t.closed, t.open, p.tailSpread);

    for (const leg of r.legs) {
      const side = leg.side > 0 ? 'R' : 'L';
      leg.hip.rotation.set(p[`hip${side}`], 0, leg.side * p.legSplay);
      leg.knee.rotation.x = -p[`knee${side}`];
      leg.ankle.rotation.x = p[`ankle${side}`];
      leg.toesFront.rotation.x = -p[`toes${side}`];
      leg.toesBack.rotation.x = p[`toes${side}`];
    }
  }
}
