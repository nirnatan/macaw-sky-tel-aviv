import * as THREE from 'three';
import type { CreateEnvironment, Quality } from '../contracts';
import { installAtmosphericFog, SUN_DIRECTION, SUN_INTENSITY } from './atmosphere';
import { createPost } from './post';
import { TIERS } from './quality';
import { createSky } from './sky';
import { createSun } from './sun';
import { createCloudNoise, createShoreDistance, createWaterNormals } from './textures';
import { createSea } from './water';

export const createEnvironment: CreateEnvironment = ({ renderer, scene, camera, sea, quality }) => {
  renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the post chain
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186 removed PCFSoft; PCF + shadow.radius is the soft path
  installAtmosphericFog(scene);

  const cloudNoise = createCloudNoise();
  const shore = createShoreDistance(sea);
  const sky = createSky(cloudNoise);
  const sun = createSun(scene);
  const sunRadiance = sun.light.color.clone().multiplyScalar(SUN_INTENSITY);
  const water = createSea(sea, { normals: createWaterNormals(), shore: shore.texture, shoreRect: shore.rect, clouds: cloudNoise }, sunRadiance);
  scene.add(sky.mesh, water.mesh);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(sky.envScene, 0.03).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();

  const size = renderer.getSize(new THREE.Vector2());
  let speed = 0;
  let time = 0;

  function buildPost(q: Quality) {
    const tier = TIERS[q];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.maxPixelRatio));
    sun.setShadowQuality(tier.shadowMapSize, tier.shadowRadius);
    sky.setCloudDetail(tier.detail);
    water.setDetail(tier.detail);
    const built = createPost(renderer, scene, camera, tier);
    built.composer.setSize(size.x, size.y);
    built.setSpeed(speed);
    return built;
  }
  let post = buildPost(quality);

  return {
    sunDirection: SUN_DIRECTION.clone(),
    sunColor: sun.light.color,
    update(dt, focus) {
      time += dt;
      sky.setTime(time);
      water.setTime(time);
      sun.follow(focus);
    },
    render(dt) { post.composer.render(dt); },
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
