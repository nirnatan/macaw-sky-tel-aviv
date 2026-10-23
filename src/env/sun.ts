import * as THREE from 'three';
import { PALETTE, SUN_DIRECTION, SUN_INTENSITY } from './atmosphere';

const HALF_WIDTH = 250; // ground coverage across the sun direction
const DISTANCE = 1600; // light sits this far toward the sun so towers far upsun still cast into the box
const TALLEST = 200; // meters of building height the box keeps in view

// The sun is under 10 degrees up, so a square box would stretch ~7x along the ground. Instead the light-space
// "up" axis only spans the ground strip plus building height: ground at distance s toward the sun maps to
// -s*sin(e), a point at height y to y*cos(e).
const SIN_E = SUN_DIRECTION.y, COS_E = Math.sqrt(1 - SIN_E * SIN_E);
const BOTTOM = -(HALF_WIDTH * SIN_E + 10);
const TOP = HALF_WIDTH * SIN_E + TALLEST * COS_E;

const axisZ = SUN_DIRECTION.clone();
const axisX = new THREE.Vector3(0, 1, 0).cross(axisZ).normalize();
const axisY = axisZ.clone().cross(axisX);

export function createSun(scene: THREE.Scene) {
  const light = new THREE.DirectionalLight(PALETTE.sunLight.clone(), SUN_INTENSITY);
  light.name = 'sun';
  light.castShadow = true;
  Object.assign(light.shadow.camera, { left: -HALF_WIDTH, right: HALF_WIDTH, bottom: BOTTOM, top: TOP, near: 1, far: DISTANCE * 2 });
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 0.12;
  scene.add(light, light.target);

  const hemi = new THREE.HemisphereLight(new THREE.Color('#7f9bd0'), new THREE.Color('#5a4032'), 0.25);
  scene.add(hemi);

  const center = new THREE.Vector3();
  const snap = (v: number, step: number) => Math.round(v / step) * step;

  return {
    light,
    follow(focus: THREE.Vector3) {
      const size = light.shadow.mapSize;
      center.set(focus.x, 0, focus.z);
      const x = snap(center.dot(axisX), (2 * HALF_WIDTH) / size.x);
      const y = snap(center.dot(axisY), (TOP - BOTTOM) / size.y);
      const z = center.dot(axisZ);
      center.copy(axisX).multiplyScalar(x).addScaledVector(axisY, y).addScaledVector(axisZ, z);
      light.target.position.copy(center);
      light.position.copy(center).addScaledVector(axisZ, DISTANCE);
    },
    setShadowQuality(mapSize: number, radius: number) {
      light.shadow.mapSize.set(mapSize, mapSize);
      light.shadow.radius = radius;
      light.shadow.map?.dispose();
      light.shadow.map = null;
    },
  };
}
