import * as THREE from 'three';

/** Where a beacon's sign floats: the beacon sets anchor and scale each frame, the layout sets lift. */
export interface SignSlot {
  readonly anchor: THREE.Vector3; // board center before lift
  scale: number;
  lift: number; // meters the sign rides up its beam to clear the signs below it
}

const HALF_W = 16.5, HALF_H = 8.3; // the 30 x 15 m board at scale 1, plus a little air
const MAX_LIFT = 60; // per unit of scale
const MIN_UP = 0.3; // looking nearly straight down, raising a sign barely moves it on screen
const SETTLE_RATE = 2.5;
const GAP = 0.01; // NDC; also overshoots enough that one raise clears a blocker despite the depth approximation

interface ScreenRect { x0: number; x1: number; y0: number; y1: number; depth: number } // NDC box, center depth

const corner = new THREE.Vector3(), right = new THREE.Vector3(), camPos = new THREE.Vector3();

/** The board's NDC bounding box, as if it faced the camera exactly; null when part of it is behind the camera. */
function screenRect(slot: SignSlot, lift: number, camera: THREE.Camera): ScreenRect | null {
  const p = camera.projectionMatrix.elements, view = camera.matrixWorldInverse;
  camera.getWorldPosition(camPos);
  right.set(camPos.z - slot.anchor.z, 0, slot.anchor.x - camPos.x).normalize().multiplyScalar(HALF_W * slot.scale);
  const rect = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, depth: -corner.copy(slot.anchor).setY(slot.anchor.y + lift).applyMatrix4(view).z };
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    corner.copy(slot.anchor).addScaledVector(right, sx).setY(slot.anchor.y + lift + sy * HALF_H * slot.scale).applyMatrix4(view);
    if (corner.z > -1) return null;
    const x = (p[0] * corner.x) / -corner.z, y = (p[5] * corner.y) / -corner.z;
    rect.x0 = Math.min(rect.x0, x); rect.x1 = Math.max(rect.x1, x);
    rect.y0 = Math.min(rect.y0, y); rect.y1 = Math.max(rect.y1, y);
  }
  return rect;
}

const overlaps = (a: ScreenRect, b: ScreenRect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Lifts that clear every earlier sign in `order`, and the first sign that could not climb high enough to. */
function solve(order: readonly SignSlot[], camera: THREE.Camera, lifts: Map<SignSlot, number>): SignSlot | null {
  const up = Math.max(MIN_UP, camera.matrixWorldInverse.elements[5]); // screen-space rise of one world meter up, per unit depth
  const placed: ScreenRect[] = [];
  let stuck: SignSlot | null = null;
  for (const slot of order) {
    const cap = MAX_LIFT * slot.scale;
    let target = 0;
    let rect = screenRect(slot, target, camera);
    for (let pass = 0; rect && pass < order.length * 2; pass++) {
      const blocker = placed.find((b) => overlaps(rect!, b));
      if (!blocker) break;
      target = Math.min(cap, target + ((blocker.y1 - rect.y0 + GAP) * rect.depth) / (camera.projectionMatrix.elements[5] * up));
      rect = screenRect(slot, target, camera);
      if (target === cap) { stuck ??= slot; break; }
    }
    if (rect) placed.push(rect);
    lifts.set(slot, target);
  }
  return stuck;
}

/**
 * Keeps every sign readable: in priority order, a sign that would cover or hide behind an earlier one on screen
 * rides up its own beam until it sits above it. The order is fixed, so signs never swap places as the bird flies,
 * except that a far sign hidden behind a much nearer one stays put and the near one climbs over it instead.
 */
export function layoutSigns(slots: readonly SignSlot[], camera: THREE.Camera, dt: number) {
  const lifts = new Map<SignSlot, number>();
  let order = slots;
  let stuck = solve(order, camera, lifts);
  for (let tries = 1; stuck && tries < slots.length; tries++) {
    order = [stuck, ...order.filter((s) => s !== stuck)];
    stuck = solve(order, camera, lifts);
  }
  const settle = 1 - Math.exp(-dt * SETTLE_RATE);
  for (const slot of slots) slot.lift += (lifts.get(slot)! - slot.lift) * settle;
}
