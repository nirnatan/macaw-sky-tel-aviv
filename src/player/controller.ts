import * as THREE from 'three';
import type { InputState, MacawAnimInput, Surface } from '../contracts';

export interface WorldQuery {
  surfaceAt(x: number, z: number, belowY?: number): Surface;
  collide(center: THREE.Vector3, radius: number): THREE.Vector3 | null;
}

// Arcade flight tuned for kids: never crash, always recoverable, land by flying low and slow (or pressing land).
const CRUISE = 15;
const FLAP_TOP = 24;
const BOOST_TOP = 44;
const MIN_AIR_SPEED = 5;
const MAX_PITCH = 1.15;
const WALK = 1.6;
const RUN = 3.4;
const BODY_RADIUS = 0.45;
const WORLD_LIMIT = 8500;
const CEILING = 650;
const LAND_TIME = 0.55;

type Mode =
  | { kind: 'air'; guidedLanding: boolean }
  | { kind: 'landing'; t: number; fromY: number; targetY: number; settleOn: THREE.Vector3 | null }
  | { kind: 'ground'; airborneFor: number };

export interface PlayerEvents {
  flap: number; // >0 on a flap stroke this frame (strength)
  landed: Surface | null;
  tookOff: boolean;
  bumped: boolean;
  blockedByWater: boolean;
}

export class Player {
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  yaw = 0; // 0 faces north (-z); positive turns left
  pitch = 0;
  bank = 0;
  speed = 0;
  walkSpeed = 0;
  mode: Mode = { kind: 'ground', airborneFor: 0 };
  altitude = 0;
  surface: Surface = { height: 0, kind: 'ground' };
  /** Where a guided landing should home in (a nearby special place), or null to land straight ahead. */
  landingAssist: THREE.Vector3 | null = null;

  private lift = 0;
  private rollSpin = 0;
  private flapClock = 0;
  private boostAmount = 0;
  private readonly anim: MacawAnimInput = { mode: 'idle', effort: 0, bank: 0, pitch: 0, walkSpeed: 0, look: 0 };
  private readonly events: PlayerEvents = { flap: 0, landed: null, tookOff: false, bumped: false, blockedByWater: false };
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tmp = new THREE.Vector3();

  private readonly footOffset: number;
  constructor(footOffset: number) { this.footOffset = footOffset; }

  get flying() { return this.mode.kind !== 'ground'; }
  get boost() { return this.boostAmount; }

  placeOnGround(x: number, z: number, yaw: number, world: WorldQuery) {
    this.surface = world.surfaceAt(x, z);
    this.position.set(x, this.surface.height + this.footOffset, z);
    this.yaw = yaw;
    this.pitch = this.bank = this.speed = this.walkSpeed = this.lift = 0;
    this.mode = { kind: 'ground', airborneFor: 0 };
    this.syncQuaternion();
  }

  forward(out: THREE.Vector3) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** Compass heading in radians: 0 = north, clockwise positive. */
  get heading() { return -this.yaw; }

  update(dt: number, input: InputState, world: WorldQuery): { anim: MacawAnimInput; events: PlayerEvents } {
    const ev = this.events;
    ev.flap = 0; ev.landed = null; ev.tookOff = false; ev.bumped = false; ev.blockedByWater = false;

    if (input.roll && this.mode.kind === 'air' && this.rollSpin === 0) this.rollSpin = input.roll * Math.PI * 2;

    if (this.mode.kind === 'ground') this.updateGround(dt, input, world);
    else if (this.mode.kind === 'landing') this.updateLanding(dt, this.mode);
    else this.updateAir(dt, input, world, this.mode);

    this.surface = world.surfaceAt(this.position.x, this.position.z, this.position.y + 0.2);
    this.altitude = Math.max(0, this.position.y - this.footOffset - this.surface.height);
    this.syncQuaternion();
    return { anim: this.anim, events: ev };
  }

  private takeOff(strong: boolean) {
    this.mode = { kind: 'air', guidedLanding: false };
    this.speed = strong ? 9 : 7;
    this.pitch = 0.45;
    this.lift = strong ? 7 : 4;
    this.events.tookOff = true;
    this.events.flap = 1;
  }

  private updateGround(dt: number, input: InputState, world: WorldQuery) {
    const mode = this.mode as Extract<Mode, { kind: 'ground' }>;
    if (input.flap || input.landToggle) return this.takeOff(true);

    this.yaw -= input.steer * 2.4 * dt;
    const target = input.climb * (input.boost ? RUN : WALK);
    this.walkSpeed = damp(this.walkSpeed, target, 8, dt);
    const sx = -Math.sin(this.yaw), sz = -Math.cos(this.yaw);
    this.position.x += (sx * this.walkSpeed + -sz * input.strafe * WALK * 0.7) * dt;
    this.position.z += (sz * this.walkSpeed + sx * input.strafe * WALK * 0.7) * dt;
    const pushed = world.collide(this.position, BODY_RADIUS * 0.6);
    if (pushed) this.position.copy(pushed);

    const feet = this.position.y - this.footOffset;
    const s = world.surfaceAt(this.position.x, this.position.z, feet + 0.6);
    if (s.kind === 'water') {
      this.position.x -= sx * this.walkSpeed * dt; // the bird refuses to walk into the sea
      this.position.z -= sz * this.walkSpeed * dt;
      this.walkSpeed = 0;
    } else if (s.height < feet - 0.7) {
      mode.airborneFor += dt;
      this.position.y -= 6 * dt; // walked off an edge: start falling, then spread the wings
      if (mode.airborneFor > 0.12) {
        this.mode = { kind: 'air', guidedLanding: false };
        this.speed = 7;
        this.pitch = -0.25;
        this.events.tookOff = true;
      }
    } else {
      mode.airborneFor = 0;
      this.position.y = damp(this.position.y, s.height + this.footOffset, 20, dt);
    }
    this.pitch = damp(this.pitch, 0, 10, dt);
    this.bank = damp(this.bank, 0, 10, dt);

    const a = this.anim;
    a.mode = Math.abs(this.walkSpeed) > 0.08 ? 'walk' : 'idle';
    a.walkSpeed = this.walkSpeed;
    a.effort = 0;
    a.look = damp(a.look, input.steer, 6, dt);
    a.bank = 0;
    a.pitch = 0;
  }

  private updateLanding(dt: number, mode: Extract<Mode, { kind: 'landing' }>) {
    mode.t += dt;
    const k = Math.min(1, mode.t / LAND_TIME);
    const ease = 1 - (1 - k) * (1 - k);
    this.position.y = mode.fromY + (mode.targetY - mode.fromY) * ease;
    this.speed = damp(this.speed, 0, 6, dt);
    if (mode.settleOn) {
      const pull = Math.min(1, dt * 8); // touch down on the special spot rather than overshooting it
      this.position.x += (mode.settleOn.x - this.position.x) * pull;
      this.position.z += (mode.settleOn.z - this.position.z) * pull;
    } else {
      const f = this.forward(this.tmp);
      this.position.x += f.x * this.speed * dt * (1 - k);
      this.position.z += f.z * this.speed * dt * (1 - k);
    }
    this.pitch = damp(this.pitch, 0.35 * (1 - k), 10, dt);
    this.bank = damp(this.bank, 0, 10, dt);
    this.anim.mode = 'land';
    this.anim.effort = 0.6;
    this.anim.bank = this.bank;
    this.anim.pitch = this.pitch;
    if (k >= 1) {
      this.mode = { kind: 'ground', airborneFor: 0 };
      this.speed = 0;
      this.walkSpeed = 0;
      this.pitch = 0;
      this.events.landed = this.surface;
    }
  }

  private updateAir(dt: number, input: InputState, world: WorldQuery, mode: Extract<Mode, { kind: 'air' }>) {
    if (input.landToggle) mode.guidedLanding = !mode.guidedLanding;
    if (input.flap) mode.guidedLanding = false;

    const boosting = input.boost && !mode.guidedLanding;
    this.boostAmount = damp(this.boostAmount, boosting ? 1 : 0, 3, dt);

    // Steering: turn rate eases off at high speed so boosting stays controllable.
    const speedNorm = THREE.MathUtils.clamp((this.speed - MIN_AIR_SPEED) / (BOOST_TOP - MIN_AIR_SPEED), 0, 1);
    this.yaw -= input.steer * (1.7 - 0.7 * speedNorm) * dt;
    this.bank = damp(this.bank, input.steer * (0.75 + 0.2 * speedNorm), 4, dt);

    let pitchTarget = input.climb * MAX_PITCH;
    if (mode.guidedLanding) pitchTarget = Math.min(pitchTarget, -0.4);
    const assist = mode.guidedLanding ? this.landingAssist : null;
    if (assist) {
      const dx = assist.x - this.position.x, dz = assist.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      const toward = Math.atan2(-dx, -dz);
      this.yaw += wrapAngle(toward - this.yaw) * Math.min(1, dt * 3) * (1 - Math.abs(input.steer));
      const above = this.position.y - this.footOffset - assist.y;
      pitchTarget = -THREE.MathUtils.clamp(Math.atan2(above, Math.max(dist - 2, 2)), 0.12, 1.0);
    }
    if (this.position.y > CEILING) pitchTarget = Math.min(pitchTarget, -0.2);
    this.pitch = damp(this.pitch, pitchTarget, input.climb === 0 && !mode.guidedLanding ? 1.5 : 3, dt);

    const distFromCenter = Math.hypot(this.position.x, this.position.z);
    if (distFromCenter > WORLD_LIMIT) {
      const home = Math.atan2(this.position.x, this.position.z); // yaw that faces the origin
      this.yaw += wrapAngle(home - this.yaw) * Math.min(1, dt * 1.2);
    }

    // Speed: gravity along the flight path, flapping thrust, boost, drag back toward cruise.
    let accel = -9.81 * Math.sin(this.pitch) * 0.85;
    const top = boosting ? BOOST_TOP : input.flap ? FLAP_TOP : CRUISE;
    if (boosting) accel += 16;
    else if (input.flap) accel += this.speed < FLAP_TOP ? 8 : 0;
    else if (this.speed < CRUISE && this.pitch > -0.2) accel += 4.5; // gentle self-flapping keeps a kid aloft
    if (this.speed > top) accel -= (this.speed - top) * (this.pitch < -0.3 ? 0.08 : 0.5);
    if (mode.guidedLanding && this.speed > (assist ? 9 : 11)) accel -= 8;
    this.speed = THREE.MathUtils.clamp(this.speed + accel * dt, MIN_AIR_SPEED, 52);

    this.lift = damp(this.lift, input.flap ? 5.5 : 0, input.flap ? 3 : mode.guidedLanding ? 6 : 1.5, dt);
    const hoverDown = assist && Math.hypot(assist.x - this.position.x, assist.z - this.position.z) < 16;
    if (hoverDown) {
      const pull = Math.min(1, dt * 2.5); // close to the spot: hover straight down onto it
      this.position.x += (assist.x - this.position.x) * pull;
      this.position.z += (assist.z - this.position.z) * pull;
      this.position.y -= Math.min(7, 2 + (this.position.y - assist.y) * 0.6) * dt;
      this.speed = damp(this.speed, MIN_AIR_SPEED, 4, dt);
      this.pitch = damp(this.pitch, 0.25, 6, dt);
    } else {
      const f = this.forward(this.tmp);
      this.position.addScaledVector(f, this.speed * dt);
      this.position.y += this.lift * dt;
    }

    const pushed = world.collide(this.position, BODY_RADIUS);
    if (pushed) {
      this.position.copy(pushed);
      this.speed *= 1 - Math.min(0.5, dt * 3);
      this.events.bumped = true;
    }

    const s = world.surfaceAt(this.position.x, this.position.z, this.position.y + 0.5);
    const floor = s.height + this.footOffset;
    const height = this.position.y - floor;
    const slowAndLow = this.speed < 11.5 && this.pitch < 0.1 && !input.flap && !boosting;
    const wantsLand = mode.guidedLanding || slowAndLow || (height < 0 && this.speed < 18 && !input.flap);
    if (height < 2.2 && (wantsLand || height < 0)) {
      if (s.kind === 'water') {
        if (height < 0.4) { this.position.y = floor + 0.4; this.pitch = Math.max(this.pitch, 0.25); }
        if (mode.guidedLanding) { mode.guidedLanding = false; this.events.blockedByWater = true; }
      } else if (wantsLand) {
        this.surface = s;
        const near = assist && Math.hypot(assist.x - this.position.x, assist.z - this.position.z) < 14 ? assist : null;
        this.mode = { kind: 'landing', t: 0, fromY: this.position.y, targetY: near ? Math.max(floor, near.y + this.footOffset) : floor, settleOn: near };
      } else {
        this.position.y = floor; // too fast to land: skim and pull up
        this.pitch = Math.max(this.pitch, 0.2);
      }
    }

    if (this.rollSpin !== 0) {
      const step = Math.sign(this.rollSpin) * Math.min(Math.abs(this.rollSpin), dt * 9);
      this.rollSpin -= step;
      if (Math.abs(this.rollSpin) < 1e-3) this.rollSpin = 0;
    }

    this.flapClock += dt;
    const flapping = input.flap || boosting || (this.speed < CRUISE - 0.5 && this.pitch > -0.2) || this.pitch > 0.35;
    if (flapping && this.flapClock > (input.flap || boosting ? 0.2 : 0.32)) { this.events.flap = input.flap ? 1 : 0.5; this.flapClock = 0; }

    const a = this.anim;
    a.mode = hoverDown || (this.speed < 7.5 && (input.flap || this.pitch > 0.2)) ? 'hover'
      : this.pitch < -0.45 ? 'dive'
      : flapping ? 'flap' : 'glide';
    a.effort = input.flap || boosting ? 1 : flapping ? 0.45 : 0.1;
    a.bank = this.bank;
    a.pitch = this.pitch;
    a.walkSpeed = 0;
    a.look = damp(a.look, input.steer, 4, dt);
  }

  private syncQuaternion() {
    const rollSpin = this.mode.kind === 'air' ? this.rollSpin : 0;
    this.euler.set(this.pitch, this.yaw, -(this.bank + rollSpin));
    this.quaternion.setFromEuler(this.euler);
  }
}

export function damp(current: number, target: number, rate: number, dt: number) {
  return target + (current - target) * Math.exp(-rate * dt);
}

export function wrapAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
