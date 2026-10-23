import * as THREE from 'three';
import {
  BlendFunction, BloomEffect, Effect, EffectAttribute, EffectComposer, EffectPass, FXAAEffect, RenderPass,
  SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { Tier } from './quality';

const gradeShader = /* glsl */ `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, 1.18);
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);
  c *= mix(vec3(0.95, 0.97, 1.06), vec3(1.05, 1.0, 0.9), smoothstep(0.02, 0.5, luma));
  float r = length((uv - 0.5) * vec2(aspect, 1.0));
  c *= mix(0.72, 1.0, smoothstep(0.95, 0.3, r));
  outputColor = vec4(max(c, 0.0), inputColor.a);
}`;

const speedShader = /* glsl */ `
uniform float amount;
float hash(float n) { return fract(sin(n * 91.345) * 43758.5453); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 d = uv - 0.5;
  float r = length(d * vec2(aspect, 1.0));
  float m = smoothstep(0.1, 0.75, r) * amount;
  vec2 stepv = d * 0.05 * m / 8.0;
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); // hides sample steps
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec2 o = stepv * (float(i) + jitter);
    acc += vec3(texture(inputBuffer, uv - o * 1.12).r, texture(inputBuffer, uv - o).g, texture(inputBuffer, uv - o * 0.88).b);
  }
  vec3 c = acc / 8.0;
  float lanes = 96.0;
  float a = atan(d.y, d.x) / 6.28318 * lanes;
  float lane = floor(a);
  float h = hash(lane);
  float across = 1.0 - abs(fract(a) - 0.5) * 2.0;
  float dash = fract(r * 1.6 - time * (1.4 + h * 1.6) + h * 9.0);
  float streak = step(0.8, h) * smoothstep(0.75, 1.0, across) * smoothstep(0.0, 0.08, dash) * smoothstep(0.45, 0.1, dash);
  c += vec3(1.0, 0.94, 0.82) * streak * smoothstep(0.32, 0.9, r) * amount * 0.22;
  outputColor = vec4(c, inputColor.a);
}`;

class GradeEffect extends Effect {
  constructor() { super('GradeEffect', gradeShader); }
}

class SpeedEffect extends Effect {
  constructor() {
    super('SpeedEffect', speedShader, { attributes: EffectAttribute.CONVOLUTION, uniforms: new Map([['amount', new THREE.Uniform(0)]]) });
  }
  set amount(v: number) { this.uniforms.get('amount')!.value = v; }
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, tier: Tier) {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));

  if (tier.ao) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const ao = new N8AOPostPass(scene, camera, size.x, size.y);
    ao.setQualityMode(tier.ao.mode);
    Object.assign(ao.configuration, { aoRadius: 8, distanceFalloff: 1, intensity: 4, halfRes: tier.ao.halfRes, depthAwareUpsampling: true });
    ao.configuration.color.set(0x1a0d08);
    composer.addPass(ao);
  }

  const bloom = new BloomEffect({
    blendFunction: BlendFunction.ADD, mipmapBlur: true, levels: tier.bloomLevels,
    luminanceThreshold: 1.1, luminanceSmoothing: 0.4, intensity: 0.4, radius: 0.6,
  });
  composer.addPass(new EffectPass(camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }), new GradeEffect()));

  const speed = new SpeedEffect();
  const speedPass = new EffectPass(camera, speed);
  speedPass.enabled = false;
  composer.addPass(speedPass);

  const aa = tier.antialias === 'smaa' ? new SMAAEffect({ preset: SMAAPreset.HIGH }) : new FXAAEffect();
  const aaPass = new EffectPass(camera, aa);
  aaPass.dithering = true;
  composer.addPass(aaPass);

  return {
    composer,
    setSpeed(amount: number) {
      speed.amount = amount;
      speedPass.enabled = amount > 0.005;
    },
  };
}
