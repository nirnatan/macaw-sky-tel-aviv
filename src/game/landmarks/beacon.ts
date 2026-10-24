import * as THREE from 'three';
import { fxMaterial, pointScale } from './fx';
import { luminance, type Mood } from './mood';
import { seeded } from './parts';
import { createSign, type SignStyle } from './sign';

const FOUND_COLOR = new THREE.Color('#5dff8a');
const BEAM_HEIGHT = 900;
const SPARKLES = 90;
const NIGHT_LUMINANCE = 1.1 * 1.6; // beam core radiance at night, well over the 1.1 bloom threshold

export interface BeaconOptions {
  position: THREE.Vector3; // landing spot (roof center)
  padRadius: number; // visual pulse ring radius
  signHeight: number; // pointer tip height above the spot
  signLift: number; // extra tip height per unit of sign growth, so far-away signs of nearby places stack instead of overlapping
  color: THREE.ColorRepresentation;
  sign: SignStyle;
}

export interface Beacon {
  readonly objects: THREE.Object3D[];
  setFound(time: number): void;
  applyLighting(m: Mood): void;
  update(dt: number, time: number, camera: THREE.Camera): void;
}

type Glow = { uBoost: { value: number }; uNear: { value: number } };

const beamMaterial = (color: THREE.Color, glow: Glow) => fxMaterial({
  blending: THREE.NormalBlending,
  uniforms: { uColor: { value: color }, uTime: { value: 0 }, ...glow },
  vertexShader: /* glsl */ `
    varying float vH; varying float vEdge; varying float vCamDist;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vec2 n = normalize(normal.xz);
      vec2 toCam = cameraPosition.xz - world.xz;
      vEdge = abs(dot(n, normalize(toCam + 1e-4)));
      vH = position.y;
      vCamDist = distance(cameraPosition, world.xyz);
      gl_Position = projectionMatrix * viewMatrix * world;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uTime; uniform float uBoost; uniform float uNear;
    varying float vH; varying float vEdge; varying float vCamDist;
    void main() {
      float core = pow(vEdge, 1.6);
      float fall = pow(1.0 - vH, 1.5) * (1.0 + 0.6 * exp(-vH * 40.0));
      float bands = 0.8 + 0.2 * sin(vH * 140.0 - uTime * 2.5);
      // Subtle up close (it is a wayfinding marker), strong and saturated from far away.
      float reach = mix(uNear, 1.0, smoothstep(60.0, 700.0, vCamDist)) * (1.0 + vCamDist / 2500.0);
      float a = clamp(core * fall * bands * reach * smoothstep(30.0, 140.0, vCamDist), 0.0, 0.9);
      gl_FragColor = vec4(uColor * 1.6 * mix(sqrt(uBoost), uBoost, smoothstep(80.0, 400.0, vCamDist)), a); // full night boost only from afar, no glare up close
    }`,
});

const pulseMaterial = (color: THREE.Color, glow: Glow) => fxMaterial({
  uniforms: { uColor: { value: color }, uTime: { value: 0 }, uBoost: glow.uBoost },
  vertexShader: /* glsl */ `
    varying vec2 vP;
    void main() { vP = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uTime; uniform float uBoost;
    varying vec2 vP;
    void main() {
      float r = length(vP);
      float a = 0.0;
      for (int k = 0; k < 3; k++) {
        float ph = fract(uTime * 0.4 + float(k) / 3.0);
        a += smoothstep(0.06, 0.0, abs(r - ph)) * (1.0 - ph) * 0.7;
      }
      a += smoothstep(0.03, 0.0, abs(r - 0.95)) * (0.5 + 0.15 * sin(uTime * 3.0));
      a *= smoothstep(1.0, 0.97, r);
      gl_FragColor = vec4(uColor * a * uBoost, 1.0);
    }`,
});

function sparkles(center: THREE.Vector3, radius: number, color: THREE.Color, glow: Glow): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const rand = seeded(Math.round(center.x * 7 + center.z));
  const seeds = new Float32Array(SPARKLES * 4).map(() => rand());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKLES * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const mat = fxMaterial({
    uniforms: { uColor: { value: color }, uTime: { value: 0 }, uRadius: { value: radius }, uScale: { value: 600 }, uBoost: glow.uBoost },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime; uniform float uRadius; uniform float uScale;
      varying float vAlpha;
      void main() {
        float life = 5.0 + aSeed.w * 4.0;
        float t = fract(uTime / life + aSeed.x);
        float ang = aSeed.y * 6.2832 + uTime * (0.25 + aSeed.z * 0.35);
        float rad = uRadius * (0.25 + 0.75 * aSeed.z) * (1.0 - 0.5 * t);
        vec3 p = vec3(cos(ang) * rad, 1.0 + t * 80.0, sin(ang) * rad);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(2.5, uScale * (1.4 + aSeed.w * 1.4) / -mv.z);
        vAlpha = sin(t * 3.1416) * (0.55 + 0.45 * sin(uTime * 9.0 + aSeed.x * 60.0));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uBoost;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float glow = exp(-dot(d, d) * 30.0);
        float rays = exp(-abs(d.x) * 40.0) * exp(-abs(d.y) * 5.0) + exp(-abs(d.y) * 40.0) * exp(-abs(d.x) * 5.0);
        gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.45) * (glow + rays * 0.8) * vAlpha * sqrt(uBoost), 1.0); // the white-mixed sparkle core needs less help than the colored beam
      }`,
  });
  const points = new THREE.Points(g, mat);
  points.position.copy(center);
  points.frustumCulled = false;
  return points;
}

export function createBeacon(o: BeaconOptions): Beacon {
  const base = new THREE.Color(o.color);
  const color = base.clone(); // shared by every uniform below, so lerping it recolors the whole beacon
  const glow: Glow = { uBoost: { value: 1 }, uNear: { value: 0.25 } };
  let nightBoost = 0;
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0);
  const beam = new THREE.Mesh(beamGeo, beamMaterial(color, glow));
  beam.position.copy(o.position);
  beam.frustumCulled = false;
  beam.renderOrder = 3;

  const pulse = new THREE.Mesh(new THREE.CircleGeometry(o.padRadius, 64), pulseMaterial(color, glow));
  pulse.rotation.x = -Math.PI / 2;
  pulse.position.copy(o.position).y += 0.15;
  pulse.renderOrder = 3;

  const spark = sparkles(o.position, o.padRadius, color, glow);
  const sign = createSign(o.sign);
  sign.mesh.position.copy(o.position);
  sign.mesh.renderOrder = 5; // drawn over its own beam, which passes in front of it

  let foundAt: number | null = null;
  let yaw: number | null = null;
  const tmp = new THREE.Vector3();
  return {
    objects: [beam, pulse, spark, sign.mesh],
    setFound(time) {
      if (foundAt !== null) return;
      foundAt = time;
      sign.setFound(true);
    },
    applyLighting(m) {
      nightBoost = Math.max(m.glow, 0.6 * m.gray);
      glow.uNear.value = 0.25 + 0.2 * Math.max(m.glow, m.gray);
      sign.applyLighting(m);
    },
    update(dt, time, camera) {
      if (foundAt !== null) color.lerpColors(base, FOUND_COLOR, Math.min(1, (time - foundAt) / 1.2));
      for (const mat of [beam.material, pulse.material, spark.material]) mat.uniforms.uTime.value = time;
      glow.uBoost.value = THREE.MathUtils.lerp(1, NIGHT_LUMINANCE / (1.6 * luminance(color)), nightBoost); // normalized, so pink and orange beams match

      const cam = camera.getWorldPosition(tmp);
      const dist = Math.hypot(cam.x - o.position.x, cam.z - o.position.z);
      const r = Math.max(5, dist * 0.009);
      beam.scale.set(r, BEAM_HEIGHT, r);
      spark.material.uniforms.uScale.value = pointScale(camera);

      // Grows with distance so the name stays readable from far away, capped so it never dominates the sky.
      const s = THREE.MathUtils.clamp(dist / 130, 1, 10);
      const m = sign.mesh;
      m.scale.setScalar(s);
      m.position.y = o.position.y + o.signHeight + o.signLift * (s - 1) + 7.5 * s + Math.sin(time * 1.1) * 0.6 * s;
      const target = Math.atan2(cam.x - m.position.x, cam.z - m.position.z);
      yaw ??= target;
      const delta = Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
      yaw += delta * Math.min(1, dt * 1.6);
      m.rotation.set(0, yaw + Math.sin(time * 0.5) * 0.06, Math.sin(time * 0.8) * 0.02);
    },
  };
}
