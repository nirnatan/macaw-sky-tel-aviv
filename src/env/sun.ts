import * as THREE from 'three';

const HALF_WIDTH = 250; // ground coverage across the light direction
const DISTANCE = 1600; // light sits this far toward the key so towers far uplight still cast into the box
const TALLEST = 200; // meters of building height the box keeps in view

// One directional light plays the sun by day and the moon at night; its direction, color and intensity
// change, never its presence or castShadow (both are in three's program key).
export function createSun(scene: THREE.Scene) {
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.name = 'sun';
  light.castShadow = true;
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 0.12;
  scene.add(light, light.target);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.25);
  scene.add(hemi);

  // The key is usually low, so a square box would stretch ~7x along the ground. Instead the light-space
  // "up" axis only spans the ground strip plus building height: ground at distance s toward the light
  // maps to -s*sin(e), a point at height y to y*cos(e).
  const axisZ = new THREE.Vector3(), axisX = new THREE.Vector3(), axisY = new THREE.Vector3();
  let bottom = 0, top = 1;
  const center = new THREE.Vector3();
  const snap = (v: number, step: number) => Math.round(v / step) * step;

  return {
    light,
    setDirection(dir: THREE.Vector3) {
      axisZ.copy(dir).normalize();
      axisX.set(0, 1, 0).cross(axisZ).normalize();
      axisY.copy(axisZ).cross(axisX);
      const sinE = axisZ.y, cosE = Math.sqrt(1 - sinE * sinE);
      bottom = -(HALF_WIDTH * sinE + 10);
      top = HALF_WIDTH * sinE + TALLEST * cosE;
      Object.assign(light.shadow.camera, { left: -HALF_WIDTH, right: HALF_WIDTH, bottom, top, near: 1, far: DISTANCE * 2 });
      light.shadow.camera.updateProjectionMatrix();
    },
    setKey(color: THREE.Color, intensity: number) {
      light.color.copy(color);
      light.intensity = intensity;
    },
    setHemi(sky: THREE.Color, ground: THREE.Color, intensity: number) {
      hemi.color.copy(sky);
      hemi.groundColor.copy(ground);
      hemi.intensity = intensity;
    },
    setShadowFade(f: number) { light.shadow.intensity = f; },
    follow(focus: THREE.Vector3) {
      const size = light.shadow.mapSize;
      center.set(focus.x, 0, focus.z);
      const x = snap(center.dot(axisX), (2 * HALF_WIDTH) / size.x);
      const y = snap(center.dot(axisY), (top - bottom) / size.y);
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
