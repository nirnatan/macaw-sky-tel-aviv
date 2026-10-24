import * as THREE from 'three';
import type { CreateRain, Lighting, Quality } from '../contracts';
import { fxMaterial } from '../game/landmarks/fx';

interface Tier {
  streaks: number;
  box: readonly [number, number, number]; // meters, x y z
  splashSlots: number;
  splashRate: number; // per second at full rain
}

const TIERS: Record<Quality, Tier> = {
  low: { streaks: 1200, box: [34, 28, 34], splashSlots: 64, splashRate: 40 },
  medium: { streaks: 2500, box: [40, 32, 40], splashSlots: 128, splashRate: 100 },
  high: { streaks: 5000, box: [48, 36, 48], splashSlots: 256, splashRate: 200 },
};
const MAX_STREAKS = TIERS.high.streaks;
const MAX_SPLASHES = TIERS.high.splashSlots;

const FALL_SPEED = 7.5; // m/s for the slowest drops
const FALL_PERIOD = 8; // speed steps are 1/FALL_PERIOD apart, so after FALL_PERIOD box heights every step is back in phase and uFall can wrap
const SPEED_STEPS = 4; // drops fall at 1, 1.125, 1.25 and 1.375 times FALL_SPEED
const EXPOSURE = 0.05; // seconds of motion each streak shows
const MAX_LENGTH = 1.8; // meters; capping fast streaks keeps them from thinning to nothing
const BOX_AHEAD = 0.3; // share of the box depth its center sits in front of the camera
const TELEPORT = 6; // meters per frame beyond which the camera jumped rather than moved
const VELOCITY_SMOOTHING = 10; // 1/s
const SPLASH_LIFE = 0.42; // seconds
const SPLASH_NEAR = 3;
const SPLASH_FAR = 25;
const SPLASH_CEILING = 40; // meters above the surface where splashes stop spawning
const MAX_RADIANCE = 0.35; // linear; under the 1.1 bloom threshold even when stacked
const MIN_LUMINANCE = 0.07; // keeps the rain readable on the darkest night
const NIGHT_SHEEN = new THREE.Color(0.1, 0.13, 0.2); // drops catching the city lights
const SILVER = new THREE.Color(0.9, 0.97, 1.12);

const STREAK_VERT = /* glsl */ `
  attribute vec4 aSeed;
  uniform vec3 uOrigin; uniform vec3 uBox; uniform vec2 uDrift; uniform float uFall;
  uniform vec3 uWind; uniform vec3 uCameraVelocity; uniform float uOpacity;
  uniform float uScale; uniform vec2 uViewport;
  varying vec2 vUv; varying float vAlpha; varying float vRim;
  const float FALL_SPEED = ${FALL_SPEED.toFixed(3)};
  const float EXPOSURE = ${EXPOSURE.toFixed(3)};
  const float MAX_LENGTH = ${MAX_LENGTH.toFixed(3)};
  const float WIDTH = 0.02;
  const float NEAR = 0.3;
  void main() {
    float speed = 1.0 + floor(aSeed.w * ${SPEED_STEPS}.0) / ${FALL_PERIOD}.0;
    vec3 boxMin = uOrigin - 0.5 * uBox;
    vec3 lattice = aSeed.xyz * uBox + vec3(uDrift.x, -uFall * speed, uDrift.y);
    vec3 head = boxMin + mod(lattice - boxMin, uBox);
    vec3 q = (head - boxMin) / uBox;
    vec3 edge = smoothstep(0.0, 0.12, q) * smoothstep(1.0, 0.88, q);

    vec3 trail = (vec3(uWind.x, -FALL_SPEED * speed, uWind.z) - uCameraVelocity) * EXPOSURE;
    float trailLength = length(trail);
    trail *= min(1.0, MAX_LENGTH / max(trailLength, 1e-4));
    float drawnLength = min(trailLength, MAX_LENGTH);
    float energy = min(1.0, FALL_SPEED * speed * EXPOSURE / max(drawnLength, 1e-4)); // long streaks spread the same light thinner

    vec4 h = modelViewMatrix * vec4(head, 1.0);
    vec4 t = modelViewMatrix * vec4(head - trail, 1.0);
    float visible = step(h.z, -NEAR) + step(t.z, -NEAR) > 0.5 ? 1.0 : 0.0;
    if (h.z > -NEAR) h = mix(t, h, (t.z + NEAR) / (t.z - h.z)); // clip the segment at the near plane
    if (t.z > -NEAR) t = mix(h, t, (h.z + NEAR) / (h.z - t.z));
    vec4 ch = projectionMatrix * h;
    vec4 ct = projectionMatrix * t;
    vec2 halfViewport = 0.5 * uViewport;
    vec2 d = (ch.xy / ch.w - ct.xy / ct.w) * halfViewport;
    float pixels = length(d);
    vec2 along = pixels > 1e-3 ? d / pixels : vec2(0.0, 1.0);
    vec2 across = vec2(-along.y, along.x);

    float isTail = position.y;
    vec4 clip = mix(ch, ct, isTail);
    float depth = mix(-h.z, -t.z, isTail);
    float width = WIDTH * uScale / depth;
    float drawnWidth = max(width, 1.0);
    vec2 offset = across * position.x * drawnWidth * 0.5 + along * (0.5 - isTail) * drawnWidth; // round off the ends
    clip.xy += offset / halfViewport * clip.w;
    gl_Position = visible > 0.5 ? clip : vec4(0.0, 0.0, 2.0, 1.0); // wholly behind the eye: outside the clip volume

    float brightness = 0.55 + 0.45 * fract(aSeed.w * 7.31);
    float lens = smoothstep(0.6, 2.5, -h.z); // drops brushing past the chase camera would be huge blurs
    vAlpha = visible * uOpacity * brightness * edge.x * edge.y * edge.z * lens * energy * width / drawnWidth;
    vUv = vec2(position.x, isTail);
    vRim = smoothstep(1.5, 3.0, drawnWidth);
  }`;

const STREAK_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv; varying float vAlpha; varying float vRim;
  void main() {
    float a = vAlpha * (1.0 - vUv.x * vUv.x) * mix(1.0, 0.35, vUv.y);
    float shade = mix(1.0, mix(0.4, 1.0, smoothstep(0.8, 0.3, abs(vUv.x))), vRim); // a darker rim keeps wide near streaks readable on mid-grey roofs
    gl_FragColor = vec4(uColor * shade * a, a); // over blending: silver on dark backdrops, soft grey lines on a bright sky
  }`;

const SPLASH_VERT = /* glsl */ `
  attribute vec4 aSplash; attribute float aSeed;
  uniform float uTime; uniform float uScale;
  varying vec2 vLocal; varying float vAge; varying float vSinE; varying float vCosE; varying float vSeed; varying float vPixel;
  const float LIFE = ${SPLASH_LIFE.toFixed(3)};
  const float SIZE = 0.42;
  void main() {
    float age = (uTime - aSplash.w) / LIFE;
    float alive = step(0.0, age) * step(age, 1.0);
    vec3 center = aSplash.xyz;
    vec3 toCamera = cameraPosition - center;
    float dist = length(toCamera);
    vec3 view = toCamera / dist;
    vec3 side = cross(vec3(0.0, 1.0, 0.0), view);
    vec3 right = length(side) > 0.05 ? normalize(side) : vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = cross(view, right);
    float sinE = max(view.y, 0.12);
    float cosE = sqrt(1.0 - sinE * sinE);
    vec2 local = position.xy * SIZE * alive;
    local.y += SIZE * 0.45 * cosE * alive; // the droplets fly up, so the quad reaches higher than the ring
    vec4 mv = viewMatrix * vec4(center + right * local.x + up * local.y, 1.0);
    mv.xyz *= max(length(mv.xyz) - 0.35, 0.0) / length(mv.xyz); // nudged toward the eye to stay in front of the roof it sits on
    gl_Position = projectionMatrix * mv;
    vLocal = local;
    vAge = age;
    vSinE = sinE;
    vCosE = cosE;
    vSeed = aSeed;
    vPixel = dist / uScale;
  }`;

const SPLASH_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uOpacity;
  varying vec2 vLocal; varying float vAge; varying float vSinE; varying float vCosE; varying float vSeed; varying float vPixel;
  const float LIFE = ${SPLASH_LIFE.toFixed(3)};
  void main() {
    float fade = 1.0 - vAge;
    float radius = 0.06 + 0.24 * (1.0 - fade * fade);
    float ringWidth = max(0.025, vPixel);
    float ellipse = length(vec2(vLocal.x, vLocal.y / vSinE));
    float ringOffset = (ellipse - radius) / ringWidth;
    float ring = exp(-ringOffset * ringOffset) * fade * fade * min(1.0, 0.025 / vPixel);
    float drops = 0.0;
    float t = vAge * LIFE;
    float dropRadius = max(0.018, vPixel * 0.8);
    for (int i = 0; i < 5; i++) {
      float k = fract(vSeed * 13.7 + float(i) * 0.618);
      float angle = vSeed * 6.283 + float(i) * 1.2566 + k;
      float reach = (0.5 + 0.5 * k) * t;
      float rise = (1.4 + 0.8 * fract(k * 7.1)) * t - 4.9 * t * t;
      vec2 p = vec2(cos(angle) * reach, sin(angle) * reach * vSinE + max(rise, 0.0) * vCosE);
      vec2 dp = vLocal - p;
      drops += exp(-dot(dp, dp) / (dropRadius * dropRadius)) * step(0.0, rise) * min(1.0, 0.018 / vPixel);
    }
    float a = uOpacity * clamp(ring * 0.8 + drops * fade, 0.0, 1.0);
    gl_FragColor = vec4(uColor * a, a);
  }`;

const wrap = (v: number, period: number) => ((v % period) + period) % period;

const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const scratch = new THREE.Color();

/** Silvery drops lit by the sky haze and a little by the key light, never dark at night and never bright enough to bloom. */
function rainTint(out: THREE.Color, l: Lighting): THREE.Color {
  out.copy(l.hazeColor).multiplyScalar(1.15).add(scratch.copy(l.sunColor).multiplyScalar(0.035 * (1 - 0.6 * l.overcast)));
  const sheen = scratch.copy(NIGHT_SHEEN).multiplyScalar(THREE.MathUtils.smoothstep(l.night, 0.3, 1));
  out.setRGB(Math.max(out.r, sheen.r), Math.max(out.g, sheen.g), Math.max(out.b, sheen.b));
  out.lerp(scratch.setScalar(luminance(out)), 0.4).multiply(SILVER);
  out.multiplyScalar(Math.max(1, MIN_LUMINANCE / Math.max(luminance(out), 1e-4)));
  return out.multiplyScalar(Math.min(1, MAX_RADIANCE / Math.max(out.r, out.g, out.b)));
}

function quad(geometry: THREE.InstancedBufferGeometry, corners: number[]) {
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
}

function viewSize(renderer: THREE.WebGLRenderer, out: THREE.Vector2) {
  const target = renderer.getRenderTarget();
  return target ? out.set(target.width, target.height) : renderer.getDrawingBufferSize(out);
}

export const createRain: CreateRain = ({ quality, surfaceAt }) => {
  let tier = TIERS[quality];
  const color = { value: new THREE.Color() };
  const opacity = { value: 1 };
  const scale = { value: 600 };

  const streakGeometry = new THREE.InstancedBufferGeometry();
  quad(streakGeometry, [-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]); // x: across, y: 0 head, 1 tail
  const seeds = new Float32Array(MAX_STREAKS * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  streakGeometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  streakGeometry.instanceCount = 0;
  const streakUniforms = {
    uOrigin: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...tier.box) }, uDrift: { value: new THREE.Vector2() },
    uFall: { value: 0 }, uWind: { value: new THREE.Vector3() }, uCameraVelocity: { value: new THREE.Vector3() },
    uOpacity: opacity, uScale: scale, uViewport: { value: new THREE.Vector2() }, uColor: color,
  };
  const premultiplied = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor } as const;
  const streaks = new THREE.Mesh(streakGeometry, fxMaterial({ name: 'rain-streaks', vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG, uniforms: streakUniforms, ...premultiplied }));

  const splashGeometry = new THREE.InstancedBufferGeometry();
  quad(splashGeometry, [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);
  const splashData = new Float32Array(MAX_SPLASHES * 5); // x, y, z, birth time, seed
  for (let i = 0; i < MAX_SPLASHES; i++) splashData[i * 5 + 3] = -1e6;
  const splashBuffer = new THREE.InstancedInterleavedBuffer(splashData, 5).setUsage(THREE.DynamicDrawUsage);
  splashGeometry.setAttribute('aSplash', new THREE.InterleavedBufferAttribute(splashBuffer, 4, 0));
  splashGeometry.setAttribute('aSeed', new THREE.InterleavedBufferAttribute(splashBuffer, 1, 4));
  splashGeometry.instanceCount = tier.splashSlots;
  const splashUniforms = { uTime: { value: 0 }, uScale: scale, uColor: color, uOpacity: opacity };
  const splashes = new THREE.Mesh(splashGeometry, fxMaterial({ name: 'rain-splashes', vertexShader: SPLASH_VERT, fragmentShader: SPLASH_FRAG, uniforms: splashUniforms, ...premultiplied }));

  const object = new THREE.Group();
  object.name = 'rain';
  object.visible = false;
  for (const mesh of [streaks, splashes]) {
    mesh.frustumCulled = false; // positions are computed in the shader around the camera
    mesh.renderOrder = 1;
    mesh.userData.treatAsOpaque = true; // keeps N8AO from drawing the rain a second time into its transparency buffer
    object.add(mesh);
  }
  const drawSize = new THREE.Vector2();
  streaks.onBeforeRender = (renderer, _scene, camera) => {
    const size = viewSize(renderer, drawSize);
    streakUniforms.uViewport.value.copy(size);
    scale.value = (size.y * camera.projectionMatrix.elements[5]) / 2;
  };

  let time = 0;
  let fall = 0;
  let splashDebt = 0;
  let cursor = 0;
  let primed = false;
  const drift = streakUniforms.uDrift.value;
  const wind = streakUniforms.uWind.value;
  const cameraVelocity = streakUniforms.uCameraVelocity.value;
  const cameraPosition = new THREE.Vector3();
  const lastCamera = new THREE.Vector3();
  const motion = new THREE.Vector3();
  const forward = new THREE.Vector3();

  function trackCamera(dt: number, camera: THREE.PerspectiveCamera) {
    camera.getWorldPosition(cameraPosition);
    motion.subVectors(cameraPosition, lastCamera);
    if (!primed || motion.lengthSq() > TELEPORT * TELEPORT) cameraVelocity.set(0, 0, 0);
    else if (dt > 0) cameraVelocity.lerp(motion.divideScalar(dt), 1 - Math.exp(-VELOCITY_SMOOTHING * dt));
    lastCamera.copy(cameraPosition);
    primed = true;
  }

  function spawnSplashes(dt: number, rain: number, camera: THREE.PerspectiveCamera) {
    splashDebt += tier.splashRate * rain * dt;
    const count = Math.min(Math.floor(splashDebt), tier.splashSlots);
    splashDebt -= Math.floor(splashDebt);
    if (count === 0) return;
    const heading = Math.atan2(forward.x, forward.z);
    const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect) * 1.15;
    const spread = THREE.MathUtils.lerp(halfFov, Math.PI, THREE.MathUtils.smoothstep(-forward.y, 0.5, 0.9)); // looking down, the footprint is all around
    let runStart = cursor, runLength = 0;
    for (let i = 0; i < count; i++) {
      const angle = heading + (Math.random() * 2 - 1) * spread;
      const distance = Math.sqrt(THREE.MathUtils.lerp(SPLASH_NEAR ** 2, SPLASH_FAR ** 2, Math.random()));
      const x = cameraPosition.x + Math.sin(angle) * distance;
      const z = cameraPosition.z + Math.cos(angle) * distance;
      const surface = surfaceAt(x, z, cameraPosition.y);
      if (surface.kind === 'water' || Math.random() * SPLASH_CEILING < cameraPosition.y - surface.height) continue;
      const o = cursor * 5;
      splashData[o] = x; splashData[o + 1] = surface.height + 0.02; splashData[o + 2] = z;
      splashData[o + 3] = time - Math.random() * dt;
      splashData[o + 4] = Math.random();
      runLength++;
      if (++cursor === tier.splashSlots) {
        splashBuffer.addUpdateRange(runStart * 5, runLength * 5);
        cursor = runStart = runLength = 0;
      }
    }
    if (runLength > 0) splashBuffer.addUpdateRange(runStart * 5, runLength * 5);
    splashBuffer.needsUpdate = true;
  }

  return {
    object,
    update(dt, l, camera) {
      object.visible = l.rain > 0.001;
      trackCamera(dt, camera);
      if (!object.visible) return;
      time += dt;
      const box = streakUniforms.uBox.value;
      wind.set(0.9 + 0.45 * Math.sin(time * 0.37), 0, 0.5 + 0.3 * Math.sin(time * 0.23 + 1));
      drift.set(wrap(drift.x + wind.x * dt, box.x), wrap(drift.y + wind.z * dt, box.z));
      fall = wrap(fall + FALL_SPEED * dt, box.y * FALL_PERIOD);
      streakUniforms.uFall.value = fall;
      camera.getWorldDirection(forward);
      streakUniforms.uOrigin.value.copy(cameraPosition).addScaledVector(forward, box.z * BOX_AHEAD);
      streakGeometry.instanceCount = Math.round(tier.streaks * l.rain);
      splashUniforms.uTime.value = time;
      opacity.value = 0.5 + 0.5 * Math.sqrt(l.rain);
      rainTint(color.value, l);
      spawnSplashes(dt, l.rain, camera);
    },
    setQuality(q) {
      tier = TIERS[q];
      streakUniforms.uBox.value.set(...tier.box);
      fall = 0;
      splashGeometry.instanceCount = tier.splashSlots;
      cursor %= tier.splashSlots;
    },
  };
};
