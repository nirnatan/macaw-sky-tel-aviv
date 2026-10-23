import * as THREE from 'three';

// One source of truth for the golden-hour look. Sky, sea and every built-in material's fog read these,
// so the far city, the sea and the sky meet at the horizon in the same haze color.

const SUN_ELEVATION = THREE.MathUtils.degToRad(8.5);
const SUN_AZIMUTH = THREE.MathUtils.degToRad(255); // compass bearing, clockwise from north (-z)

export const SUN_DIRECTION = new THREE.Vector3(
  Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH),
  Math.sin(SUN_ELEVATION),
  -Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH),
).normalize();

const srgb = (hex: string, scale = 1) => new THREE.Color(hex).multiplyScalar(scale);

export const PALETTE = {
  sunLight: srgb('#ff8f45'),
  sunDisk: srgb('#ffb060', 22),
  skyZenith: srgb('#35609a'),
  skyMidAway: srgb('#a3b0d0'),
  skyMidSun: srgb('#f3bb72', 0.8),
  skyHorizonAway: srgb('#dea39c'),
  skyHorizonSun: srgb('#ff8f3d', 1.2),
  skyGlow: srgb('#ff8a35', 1.0),
  hazeAway: srgb('#ab99a4', 0.72),
  hazeSun: srgb('#ff9a52', 0.85),
  hazeGlow: srgb('#ff9c42', 1.4),
  cloudLit: srgb('#ffb48c', 1.25),
  cloudShade: srgb('#7c6a83', 0.9),
  ground: srgb('#4a3a30', 0.6),
} as const;

export const SUN_INTENSITY = 4.2;
export const FOG_DENSITY = 0.0004; // at sea level: things fade into the haze by ~5 km
const FOG_HEIGHT_FALLOFF = 1 / 420; // haze thins with altitude

export const glslVec3 = (c: THREE.Color | THREE.Vector3) => {
  const [x, y, z] = c instanceof THREE.Color ? [c.r, c.g, c.b] : [c.x, c.y, c.z];
  return `vec3(${x.toFixed(5)}, ${y.toFixed(5)}, ${z.toFixed(5)})`;
};

export const ATMOSPHERE_GLSL = /* glsl */ `
const vec3 SUN_DIR = ${glslVec3(SUN_DIRECTION)};
const vec3 SKY_ZENITH = ${glslVec3(PALETTE.skyZenith)};
const vec3 SKY_MID_AWAY = ${glslVec3(PALETTE.skyMidAway)};
const vec3 SKY_MID_SUN = ${glslVec3(PALETTE.skyMidSun)};
const vec3 SKY_HORIZON_AWAY = ${glslVec3(PALETTE.skyHorizonAway)};
const vec3 SKY_HORIZON_SUN = ${glslVec3(PALETTE.skyHorizonSun)};
const vec3 SKY_GLOW = ${glslVec3(PALETTE.skyGlow)};
const vec3 HAZE_AWAY = ${glslVec3(PALETTE.hazeAway)};
const vec3 HAZE_SUN = ${glslVec3(PALETTE.hazeSun)};
const vec3 HAZE_GLOW = ${glslVec3(PALETTE.hazeGlow)};
const float FOG_HEIGHT_FALLOFF = ${FOG_HEIGHT_FALLOFF.toFixed(6)};

float atmoSunSide(vec3 dir) {
  vec2 h = dir.xz / max(length(dir.xz), 1e-4);
  float side = dot(h, normalize(SUN_DIR.xz)) * 0.5 + 0.5;
  return side * side;
}

vec3 atmoHaze(vec3 dir) {
  float mu = max(dot(dir, SUN_DIR), 0.0);
  vec3 c = mix(HAZE_AWAY, HAZE_SUN, atmoSunSide(dir));
  return c + HAZE_GLOW * (pow(mu, 10.0) * 0.38 + pow(mu, 90.0) * 1.3);
}

vec3 atmoSky(vec3 dir) {
  float y = max(dir.y, 0.0);
  float mu = max(dot(dir, SUN_DIR), 0.0);
  float side = atmoSunSide(dir);
  float sunward = side * side;
  vec3 horizon = mix(SKY_HORIZON_AWAY, SKY_HORIZON_SUN, sunward);
  vec3 mid = mix(SKY_MID_AWAY, SKY_MID_SUN, sunward);
  float a = sqrt(y);
  vec3 sky = mix(mix(horizon, mid, smoothstep(0.0, 0.4, a)), SKY_ZENITH, smoothstep(0.3, 1.0, a));
  sky += SKY_GLOW * (pow(mu, 4.0) * 0.18 + pow(mu, 16.0) * 0.7 + pow(mu, 280.0) * 2.4);
  return mix(sky, atmoHaze(dir), exp(-y * 16.0));
}

float atmoTransmittance(vec3 toFrag, float density) {
  float dist = length(toFrag);
  float k = FOG_HEIGHT_FALLOFF * toFrag.y;
  float heightIntegral = abs(k) > 1e-4 ? (1.0 - exp(-k)) / k : 1.0;
  float opticalDepth = density * exp(-FOG_HEIGHT_FALLOFF * cameraPosition.y) * dist * heightIntegral;
  return exp(-opticalDepth);
}

vec3 atmoApply(vec3 color, vec3 toFrag, float density) {
  vec3 dir = normalize(toFrag);
  return mix(atmoHaze(dir), color, atmoTransmittance(toFrag, density));
}
`;

// Built-in materials (and ShaderMaterials with fog: true that include the fog chunks) get the same
// height-based, sun-tinted haze as the sky and sea instead of three's flat-color fog.
export function installAtmosphericFog(scene: THREE.Scene) {
  THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying vec3 vFogWorldDir;\n#endif';
  THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogWorldDir = mvPosition.xyz * mat3( viewMatrix );\n#endif';
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
 uniform vec3 fogColor;
 uniform float fogDensity;
 varying vec3 vFogWorldDir;
 ${ATMOSPHERE_GLSL}
#endif`;
  THREE.ShaderChunk.fog_fragment = '#ifdef USE_FOG\n gl_FragColor.rgb = atmoApply( gl_FragColor.rgb, vFogWorldDir, fogDensity );\n#endif';
  scene.fog = new THREE.FogExp2(PALETTE.hazeAway.clone(), FOG_DENSITY);
}
