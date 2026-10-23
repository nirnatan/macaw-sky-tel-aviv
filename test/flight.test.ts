import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player, type WorldQuery } from '../src/player/controller.ts';
import type { InputState } from '../src/contracts.ts';

// A 20 m roof spanning x,z in [0, 40], sea west of x = -100, ground elsewhere.
const world: WorldQuery = {
  surfaceAt(x, z, belowY = Infinity) {
    if (x >= 0 && x <= 40 && z >= 0 && z <= 40 && belowY >= 20) return { height: 20, kind: 'roof' };
    return x < -100 ? { height: 0, kind: 'water' } : { height: 0, kind: 'ground' };
  },
  collide: () => null,
};
const idle = (): InputState => ({ steer: 0, climb: 0, strafe: 0, flap: false, boost: false, landToggle: false, squawk: false, roll: 0, pause: false, device: 'keyboard' });
const run = (p: Player, seconds: number, input: Partial<InputState> = {}, onFrame?: () => void) => {
  for (let t = 0; t < seconds; t += 1 / 60) { p.update(1 / 60, { ...idle(), ...input }, world); onFrame?.(); }
};
const FOOT = 0.25;

test('space takes off from the ground and the bird climbs', () => {
  const p = new Player(FOOT);
  p.placeOnGround(200, 200, 0, world);
  run(p, 2, { flap: true });
  assert.ok(p.flying);
  assert.ok(p.altitude > 5, `altitude ${p.altitude}`);
});

test('a hands-off bird keeps flying instead of falling out of the sky', () => {
  const p = new Player(FOOT);
  p.placeOnGround(200, 200, 0, world);
  run(p, 2, { flap: true });
  run(p, 8);
  assert.ok(p.flying && p.altitude > 3, `altitude ${p.altitude}`);
});

test('pressing land over a roof glides down and lands on it', () => {
  const p = new Player(FOOT);
  p.placeOnGround(20, 400, 0, world); // south of the roof, facing north toward it
  run(p, 2, { flap: true });
  while (p.position.z > 38) p.update(1 / 60, { ...idle(), climb: p.position.y < 26 ? 0.5 : 0 }, world);
  assert.ok(p.position.y > 21, `y ${p.position.y}`);
  let landed = null as null | { height: number };
  run(p, 1 / 60, { landToggle: true });
  for (let i = 0; i < 60 * 15 && !landed; i++) landed = p.update(1 / 60, idle(), world).events.landed;
  assert.equal(landed?.height, 20, 'landed on the roof');
  assert.ok(!p.flying);
});

test('walking off a roof edge turns into flight', () => {
  const p = new Player(FOOT);
  p.placeOnGround(20, 2, 0, world); // facing north, 2 m from the north edge (z=0)
  assert.equal(p.position.y, 20 + FOOT);
  run(p, 3, { climb: 1 });
  assert.ok(p.flying, 'flying after walking off');
});

test('flying fast into the ground skims instead of going under it', () => {
  const p = new Player(FOOT);
  p.placeOnGround(200, 200, 0, world);
  run(p, 2, { flap: true });
  let minY = Infinity;
  run(p, 4, { climb: -1, boost: true }, () => { minY = Math.min(minY, p.position.y); });
  assert.ok(minY >= FOOT - 1e-6, `minY ${minY}`);
});

test('the bird will not land on the sea', () => {
  const p = new Player(FOOT);
  p.placeOnGround(-90, 0, Math.PI / 2, world); // on the shore facing west, out to sea
  run(p, 1, { flap: true });
  run(p, 3);
  let blocked = false;
  run(p, 0.01, { landToggle: true });
  for (let i = 0; i < 60 * 10; i++) if (p.update(1 / 60, idle(), world).events.blockedByWater) blocked = true;
  assert.ok(p.flying, 'still flying over water');
  assert.ok(blocked, 'reported water');
});

test('heading is 0 facing north and +90deg facing east', () => {
  const p = new Player(FOOT);
  p.placeOnGround(0, 0, 0, world);
  assert.equal(p.heading, -0);
  p.placeOnGround(0, 0, -Math.PI / 2, world);
  const f = p.forward(new THREE.Vector3());
  assert.ok(f.x > 0.99, 'east');
  assert.ok(Math.abs(p.heading - Math.PI / 2) < 1e-9);
});
