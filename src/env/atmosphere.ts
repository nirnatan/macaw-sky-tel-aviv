import * as THREE from 'three';

// One source of truth for the haze. Sky, sea and every built-in material's fog read the same uniforms,
// so the far city, the sea and the sky meet at the horizon in the same color at every time of day.
//
// The values are Float32Arrays written in place and never reassigned. three's cloneUniforms copies
// Color/Vector/Matrix/Texture values and slices plain Arrays, but keeps every other value by reference
// (three 0.186.1, UniformsUtils.js:63-65), so one array reaches every program compiled from ShaderLib.

const vec3 = () => ({ value: new Float32Array(3) });

export const atmosphereUniforms = {
  uAtmoSunDir: vec3(), // the true sun, never the moon
  uAtmoMoonDir: vec3(),
  uAtmoSkyZenith: vec3(),
  uAtmoSkyMidAway: vec3(),
  uAtmoSkyMidSun: vec3(),
  uAtmoSkyHorizonAway: vec3(),
  uAtmoSkyHorizonSun: vec3(),
  uAtmoSkyGlow: vec3(),
  uAtmoHazeAway: vec3(),
  uAtmoHazeSun: vec3(),
  uAtmoHazeGlow: vec3(),
  uAtmoCloudLit: vec3(),
  uAtmoCloudShade: vec3(),
  uAtmoParams: { value: new Float32Array(4) }, // x fog height falloff, y night, z overcast, w rainbow
} satisfies Record<string, { readonly value: Float32Array }>;

export const FOG_HEIGHT_FALLOFF = 1 / 420; // haze thins with altitude

export const ATMOSPHERE_GLSL = /* glsl */ `
uniform vec3 uAtmoSunDir;
uniform vec3 uAtmoSkyZenith;
uniform vec3 uAtmoSkyMidAway;
uniform vec3 uAtmoSkyMidSun;
uniform vec3 uAtmoSkyHorizonAway;
uniform vec3 uAtmoSkyHorizonSun;
uniform vec3 uAtmoSkyGlow;
uniform vec3 uAtmoHazeAway;
uniform vec3 uAtmoHazeSun;
uniform vec3 uAtmoHazeGlow;
uniform vec4 uAtmoParams;
#define SUN_DIR uAtmoSunDir
#define SKY_ZENITH uAtmoSkyZenith
#define SKY_MID_AWAY uAtmoSkyMidAway
#define SKY_MID_SUN uAtmoSkyMidSun
#define SKY_HORIZON_AWAY uAtmoSkyHorizonAway
#define SKY_HORIZON_SUN uAtmoSkyHorizonSun
#define SKY_GLOW uAtmoSkyGlow
#define HAZE_AWAY uAtmoHazeAway
#define HAZE_SUN uAtmoHazeSun
#define HAZE_GLOW uAtmoHazeGlow
#define FOG_HEIGHT_FALLOFF uAtmoParams.x
#define ATMO_NIGHT uAtmoParams.y
#define ATMO_OVERCAST uAtmoParams.z
#define ATMO_RAINBOW uAtmoParams.w

float atmoSunSide(vec3 dir) {
  vec2 h = dir.xz / max(length(dir.xz), 1e-4);
  float side = dot(h, SUN_DIR.xz / max(length(SUN_DIR.xz), 1e-3)) * 0.5 + 0.5;
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
// height-based, sun-tinted haze as the sky and sea instead of three's flat-color fog. Must run before
// the first material compiles: a program compiled earlier never sees the shared uniforms.
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
  for (const k in THREE.ShaderLib) Object.assign(THREE.ShaderLib[k as keyof typeof THREE.ShaderLib].uniforms, atmosphereUniforms);
  scene.fog = new THREE.FogExp2(0x000000, 0);
}

/** Dev check: a compiled fogged built-in material holds the very same array as the shared table. null = none compiled yet. */
export function sharedUniformsReachMaterials(renderer: THREE.WebGLRenderer, scene: THREE.Scene): boolean | null {
  let result: boolean | null = null;
  scene.traverse((o) => {
    if (result !== null) return;
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m?.isMeshStandardMaterial || !m.fog) return;
    const uniforms = (renderer.properties.get(m) as { uniforms?: Record<string, { value: unknown }> }).uniforms;
    if (uniforms) result = uniforms.uAtmoSunDir?.value === atmosphereUniforms.uAtmoSunDir.value;
  });
  return result;
}
