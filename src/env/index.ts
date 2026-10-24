import * as THREE from 'three';
import type { Conditions, CreateEnvironment, Lighting, Quality } from '../contracts';
import { atmosphereUniforms, FOG_HEIGHT_FALLOFF, installAtmosphericFog, sharedUniformsReachMaterials } from './atmosphere';
import { createPost } from './post';
import { TIERS } from './quality';
import { createSky } from './sky';
import { createSun } from './sun';
import { createCloudNoise, createShoreDistance, createWaterNormals } from './textures';
import { createSea } from './water';
import { createWeather } from './weather';

const BOOT_CONDITIONS: Conditions = { time: 'sunset', rain: false };

/** Dev-only probes for the harness; empty in production builds. */
export const envDev: { timeBake?: () => number; sharedUniformsOk?: boolean | null; bakes: number } = { bakes: 0 };

export const createEnvironment: CreateEnvironment = ({ renderer, scene, camera, sea, quality }) => {
  renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the post chain
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186 removed PCFSoft; PCF + shadow.radius is the soft path
  installAtmosphericFog(scene);
  const fog = scene.fog as THREE.FogExp2;

  const cloudNoise = createCloudNoise();
  const shore = createShoreDistance(sea);
  const sky = createSky(cloudNoise);
  const sun = createSun(scene);
  const water = createSea(sea, { normals: createWaterNormals(), shore: shore.texture, shoreRect: shore.rect, clouds: cloudNoise });
  scene.add(sky.mesh, water.mesh);

  const weather = createWeather(BOOT_CONDITIONS);
  const w = weather.state;
  const lighting: { -readonly [K in keyof Lighting]: Lighting[K] } = {
    sunDirection: new THREE.Vector3(), sunColor: new THREE.Color(), hazeColor: new THREE.Color(),
    night: 0, morning: 0, rain: 0, wetness: 0, overcast: 0, rainbow: 0,
  };

  const size = renderer.getSize(new THREE.Vector2());
  let tier = TIERS[quality];
  let speed = 0;
  let time = 0;
  const a = atmosphereUniforms;

  function applyWeather() {
    const row = w.row;
    w.sunDir.toArray(a.uAtmoSunDir.value);
    w.moonDir.toArray(a.uAtmoMoonDir.value);
    row.skyZenith.toArray(a.uAtmoSkyZenith.value);
    row.skyMidAway.toArray(a.uAtmoSkyMidAway.value);
    row.skyMidSun.toArray(a.uAtmoSkyMidSun.value);
    row.skyHorizonAway.toArray(a.uAtmoSkyHorizonAway.value);
    row.skyHorizonSun.toArray(a.uAtmoSkyHorizonSun.value);
    row.skyGlow.toArray(a.uAtmoSkyGlow.value);
    row.hazeAway.toArray(a.uAtmoHazeAway.value);
    row.hazeSun.toArray(a.uAtmoHazeSun.value);
    row.hazeGlow.toArray(a.uAtmoHazeGlow.value);
    row.cloudLit.toArray(a.uAtmoCloudLit.value);
    row.cloudShade.toArray(a.uAtmoCloudShade.value);
    const params = a.uAtmoParams.value;
    params[0] = FOG_HEIGHT_FALLOFF; params[1] = row.night; params[2] = w.overcast; params[3] = w.rainbow;

    row.sunDisk.toArray(sky.uniforms.uSunDisk.value);
    row.ground.toArray(sky.uniforms.uGround.value);

    const keyRadiance = lighting.sunColor.copy(row.sunLight).multiplyScalar(w.keyIntensity);
    water.uniforms.uSunRadiance.value.copy(keyRadiance);
    water.uniforms.uKeyDir.value.copy(w.keyDir);
    water.uniforms.uDeep.value.copy(row.seaDeep);
    water.uniforms.uShallow.value.copy(row.seaShallow);
    water.uniforms.uAmbient.value.copy(row.seaAmbient);
    water.uniforms.uRough.value = 1 + 0.6 * w.rain;
    water.uniforms.uRain.value = w.rain;

    sun.setDirection(w.keyDir);
    sun.setKey(row.sunLight, w.keyIntensity);
    sun.setHemi(row.hemiSky, row.hemiGround, row.hemiIntensity);
    sun.setShadowFade(w.shadowFade);

    fog.density = row.fogDensity;
    fog.color.copy(row.hazeAway);
    scene.environmentIntensity = row.envIntensity;
    renderer.toneMappingExposure = row.exposure;

    lighting.sunDirection.copy(w.keyDir);
    lighting.hazeColor.copy(row.hazeAway);
    lighting.night = row.night;
    lighting.morning = row.morning;
    lighting.rain = w.rain;
    lighting.wetness = w.wetness;
    lighting.overcast = w.overcast;
    lighting.rainbow = w.rainbow;
  }

  // Persistent env-map chain: the cube size is in every PBR program's key, so it is fixed for the session.
  const cubeRT = new THREE.WebGLCubeRenderTarget(quality === 'low' ? 128 : 256, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCamera = new THREE.CubeCamera(0.1, 10, cubeRT);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let pmremRT: THREE.WebGLRenderTarget | null = null;
  let bakedOvercast = 0;
  let frame = 0;
  function bake() {
    cubeCamera.update(renderer, sky.envScene);
    pmremRT = pmrem.fromCubemap(cubeRT.texture, pmremRT); // reuses the target and its cached shaders after the first call
    bakedOvercast = w.overcast;
    envDev.bakes++;
  }

  weather.step(0);
  applyWeather();
  bake();
  scene.environment = pmremRT!.texture;

  function applyGrade(p: ReturnType<typeof createPost>) {
    p.setGrade(w.row.gradeShadow, w.row.gradeHighlight);
    p.setAoColor(w.row.aoColor);
  }

  function buildPost(q: Quality) {
    tier = TIERS[q];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.maxPixelRatio));
    sun.setShadowQuality(tier.shadowMapSize, tier.shadowRadius);
    sky.setCloudDetail(tier.detail);
    sky.setStarDensity(tier.starDensity);
    water.setDetail(tier.detail);
    const built = createPost(renderer, scene, camera, tier);
    built.composer.setSize(size.x, size.y);
    built.setSpeed(speed);
    applyGrade(built);
    return built;
  }
  let post = buildPost(quality);

  if (import.meta.env.DEV) {
    envDev.timeBake = () => {
      const gl = renderer.getContext();
      gl.finish();
      const start = performance.now();
      bake();
      gl.finish();
      return performance.now() - start;
    };
  }

  return {
    lighting,
    setConditions(c, opts) {
      const instant = opts?.instant ?? false;
      const t = weather.target;
      if (!instant && c.time === t.time && c.rain === t.rain) return;
      weather.setConditions(c, instant);
      if (instant) { applyWeather(); bake(); }
    },
    update(dt, focus) {
      time += dt;
      frame++;
      sky.setTime(time);
      water.setTime(time);
      const step = weather.step(dt);
      applyWeather();
      applyGrade(post);
      sun.follow(focus);
      const changing = step.blending || Math.abs(w.overcast - bakedOvercast) > 0.01;
      if (step.blendEnded || (changing && frame % tier.bakeEvery === 0)) bake();
    },
    render(dt) {
      post.composer.render(dt);
      if (import.meta.env.DEV && envDev.sharedUniformsOk == null) {
        envDev.sharedUniformsOk = sharedUniformsReachMaterials(renderer, scene);
        if (envDev.sharedUniformsOk === false) console.error('env: atmosphere uniforms were cloned per material; the sky will freeze');
      }
    },
    setSize(width, height) {
      size.set(width, height);
      post.composer.setSize(width, height);
    },
    setQuality(q) {
      post.composer.dispose();
      post = buildPost(q);
    },
    setSpeedEffect(amount) {
      speed = THREE.MathUtils.clamp(amount, 0, 1);
      post.setSpeed(speed);
    },
  };
};
