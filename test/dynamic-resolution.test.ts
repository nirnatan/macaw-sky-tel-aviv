import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DynamicResolution, MIN_PIXEL_RATIO } from '../src/dynamic-resolution.ts';

const feed = (d: DynamicResolution, ms: number, seconds: number) => {
  for (let t = 0; t < seconds * 1000; t += ms) d.sample(ms);
};

test('slow frames lower the pixel ratio down to the floor and no further', () => {
  const d = new DynamicResolution(2, 2);
  feed(d, 33, 20);
  assert.equal(d.ratio, MIN_PIXEL_RATIO);
  assert.ok(d.exhausted);
});

test('fast frames raise the ratio back up, but never above the cap', () => {
  const d = new DynamicResolution(1, 1.8);
  feed(d, 8, 60);
  assert.equal(d.ratio, 1.8);
});

test('frames on budget leave the ratio alone', () => {
  const d = new DynamicResolution(1.5, 2);
  feed(d, 16.6, 30);
  assert.equal(d.ratio, 1.5);
});

test('a lower cap clamps the current ratio', () => {
  const d = new DynamicResolution(2, 2);
  d.setMax(1.25);
  assert.equal(d.ratio, 1.25);
});
