# Times of day and rain: design

Status: planned 2026-10-24. Five scouts checked the draft against the code and a critic verified the decisions in three r186 source. The final interfaces are in `src/contracts.ts`; the decisions below supersede the draft where they differ.

## What the kids get

- Four times of day: sunrise (זריחה), noon (צהריים), sunset (שקיעה, the current golden hour) and night (לילה).
- Rain on or off (גשם). When rain stops while the sun is up, a rainbow appears opposite the sun for a while.
- They pick the time and the weather on the start screen and in the pause menu. While flying, T cycles the time and R toggles rain. Changes blend smoothly over a few seconds and never freeze the game.
- Night is a storybook night, not darkness. The sky is deep blue with stars and a big moon, the city windows glow warm, streets have lamps, and the beacons over the school and the gan are brighter than ever, so the places stay easy to find.
- Rain is gentle and happy: gray-blue overcast, soft streaks around the bird, splashes on roofs and the ground, wet shiny streets, and the sound of rain. No thunder or lightning, because it could scare young kids.

## Data shape

```ts
export const TIMES = ['sunrise', 'noon', 'sunset', 'night'] as const;
export type TimeOfDay = (typeof TIMES)[number];
export interface Conditions { time: TimeOfDay; rain: boolean }

/** Blended every frame by the environment; every other module only reads it. */
export interface Lighting {
  readonly sunDirection: THREE.Vector3; // unit, toward the key light (the moon at night)
  readonly sunColor: THREE.Color;       // key light color times intensity
  night: number;    // 0 day .. 1 full night
  rain: number;     // 0..1 current rain intensity (ramps over ~5 s)
  wetness: number;  // 0..1 surface wetness; rises behind rain, dries ~20 s after it stops
  overcast: number; // 0..1 cloud cover; rain pushes it up
  rainbow: number;  // 0..1; peaks shortly after rain stops while the sun is up
}
```

The time presets are a table in the environment module: sun or moon elevation and azimuth, palette, intensities, fog density and exposure for each time. Remember that Tel Aviv's sea is to the west, so the sun rises over the city in the east and sets over the sea in the west. Blending interpolates between two table rows; nothing branches on the time name outside the table.

## Module responsibilities

| Module | Change |
|---|---|
| env (`src/env/`) | `setConditions(c)`, a `lighting: Lighting` it blends in `update()`, a preset table per time, runtime-variable atmosphere (sky, haze, fog, sea, sun and moon light, shadows fade under overcast), stars and moon at night, overcast clouds and rougher darker sea in rain, a rainbow arc opposite the sun, exposure per time. |
| city (`src/world/`) | `applyLighting(l)`: windows lit at night (warm, varied, more at dusk), street lamps along roads at night, wet streets and roofs (darker, glossier, reflective) by `wetness`. |
| landmarks (`src/game/landmarks/`) | `applyLighting(l)`: beacons, signs, rings and the gan's lights brighter at night; boats get lanterns and balloons get a burner glow at night; seagulls go home in the rain or at night. |
| rain fx (`src/fx/rain.ts`, new) | `createRain({ quality, surfaceAt })` with `update(dt, amount, camera)` and `setQuality(q)`: streaks in a volume that wraps around the camera, splashes on surfaces under the camera, stretched by bird speed. |
| ui, input, audio | Time and weather pickers on the start screen and pause menu, persisted in `Settings`. Input pressed flags `cycleTime` and `toggleRain` (keys T and R, gamepad D-pad), consumed by the UI like `pause`, with a toast when they change. Audio gets `night` and `rain` in `update()`: rain ambience, morning birdsong at sunrise, crickets at night, and music that softens at night. |
| main | Calls `env.setConditions` from settings, then passes `env.lighting` to city, landmarks, rain and audio each frame. |

## Main risk: the atmosphere is baked into shader constants

`src/env/atmosphere.ts` builds `ATMOSPHERE_GLSL` with `const vec3` values from one palette and patches three's fog chunks, so every built-in material and every custom shader bakes in the sunset. Times of day need these values at runtime. Options to evaluate:

1. Shared uniform objects injected into every material (chained `onBeforeCompile`, before first render) so one `{ value }` update reaches all programs. Smooth blending, but every material must be bound, including ones created later.
2. A uniform buffer object (`THREE.UniformsGroup`) bound to every material.
3. Recompile all programs on each change (constants stay constants). Simple, but it causes a hitch and cannot blend smoothly.

The env scout must recommend one, with evidence from the code, and name every place that reads the atmosphere constants: the sky dome, the sea shader, the fog chunks, and any city, landmark, macaw or fx shaders.

## Constraints

- Rendering changes for a condition switch must not stall a frame by more than about 50 ms on an M-series laptop. No shader recompiles during play.
- Low quality must still run on an iPad. Rain particles and city night lights scale with quality.
- Kids must always be able to see the bird and find the two places, in every time and weather.
- Contracts stay the single source of the interfaces. Each module owns its own files.

## Decisions from the planning workflow

### Runtime atmosphere

DECISION: shared uniforms, bound through THREE.ShaderLib instead of chained onBeforeCompile (the env scout's option 1 variant). Uniform values are Float32Array instances written in place. The draft's chained-onBeforeCompile option 1, the UBO option 2 and the recompile option 3 are all rejected.

Why it works. I checked each point in r186.1:
- For built-in materials, getUniforms clones ShaderLib[shaderID].uniforms (node_modules/three/src/renderers/webgl/WebGLPrograms.js:608-620). getProgram then runs onBeforeCompile and stores the result as materialProperties.uniforms (WebGLRenderer.js:2239-2253).
- cloneUniforms deep-copies only Color, Vector, Matrix, Quaternion and Texture values (isThreeObject, UniformsUtils.js:105-110). Plain JS Arrays are slice()d. Every other value is copied by reference (UniformsUtils.js:63-65).
- So `{ value: Float32Array }` entries placed in every THREE.ShaderLib[k].uniforms before the first compile give every built-in material compiled afterwards the same typed array. That includes materials created later: the lazy scarlet macaw (main.ts:80-83), lamps and lanterns.
- env.update writes the arrays in place with Color.toArray(arr) or Vector3.toArray(arr). Every program uploads the new value on its next material switch. That switch happens at least once per render, because _currentMaterialId is reset at WebGLRenderer.js:1821.
- ShaderMaterials take material.uniforms directly (WebGLPrograms.js:620). So sky.ts:64-71 and water.ts:118-126 must spread the same uniform entries; they must not clone them.
- Fog density stays on scene.fog.density. three refreshes it for every material with fog:true, ShaderMaterials included (WebGLRenderer.js:2770-2772).
- Exposure needs no new pass. postprocessing's ToneMappingEffect includes three's tonemapping_pars_fragment (postprocessing build/index.js:13385, ACES define at :13507), and WebGLRenderer.js:2751 uploads renderer.toneMappingExposure on every material refresh.

Why not the draft's chained onBeforeCompile:
- Nine materials assign onBeforeCompile directly today: flats.ts:216 and :230, trees.ts:117, buildings.ts:198, rings.ts:30, parts.ts:89, ambient.ts:124, school.ts:153, rig.ts:307. The env scout said "six" but listed nine.
- Material.customProgramCacheKey() returns onBeforeCompile.toString() (Material.js:544-546). A generic wrapper therefore gives every wrapped material the same source text, and two materials with otherwise equal parameters would share one wrong program.
- The same trap is already live. backlitFabric bakes `${strength}` into a closure whose source text is the same for every strength (parts.ts:89-95), so the school decor (0.30) and the boats (0.35) can share one program.

Why not a UBO: only ShaderMaterial has uniformsGroups, so every built-in material would still need binding by hand. It also adds std140 layout work and costs a bind on every draw.

Why not recompiling: it cannot blend. The built-in program cache key does not include chunk source, so needsUpdate would bring back the stale cached program. And it breaks the no-recompile rule.

GLSL shape:
- ATMOSPHERE_GLSL replaces each `const vec3 X` with `uniform vec3 uAtmoX;` plus `#define X uAtmoX`, so atmoSunSide, atmoHaze, atmoSky, atmoTransmittance and atmoApply keep their bodies and signatures.
- The uniforms are: uAtmoSunDir (the true sun, never the moon), SKY_ZENITH, SKY_MID_AWAY, SKY_MID_SUN, SKY_HORIZON_AWAY, SKY_HORIZON_SUN, SKY_GLOW, HAZE_AWAY, HAZE_SUN and HAZE_GLOW, plus `uniform vec4 uAtmoParams` (x = fog height falloff, y = night, z = overcast, w = rainbow).
- CLOUD_LIT and CLOUD_SHADE (sky.ts:7-8) become uniforms in the same table.
- Guard atmoSunSide's normalize(SUN_DIR.xz) (atmosphere.ts:58) with max(length, 1e-3) and keep noon elevation at 60 degrees or less.

Environment map:
- Replace the one-shot pmrem.fromScene + dispose (env/index.ts:24-27). fromScene has no renderTarget option and allocates a new target on every call (PMREMGenerator.js:107-123). Swapping scene.environment would also trigger needsProgramChange on every PBR material (WebGLRenderer.js:2484).
- Instead keep one PMREMGenerator, one WebGLCubeRenderTarget with a CubeCamera on sky.envScene, and one persistent cubeUV output target.
- Refresh explicitly in env.update with `cubeCam.update(renderer, envScene); pmrem.fromCubemap(cubeRT.texture, pmremRT)`. fromCubemap reuses the passed target (PMREMGenerator.js:277) and the cached blur and GGX shaders (:286-317).
- Set scene.environment = pmremRT.texture once. A CubeUV texture passes straight through WebGLEnvironments, as today's fromScene result does.
- Do not rely on three's lazy needsPMREMUpdate path (WebGLEnvironments.js:84-97). It works, but it runs inside the main RenderPass at the first PBR draw (environments.get at WebGLRenderer.js:2209 and :2380), and that is harder to schedule and time.
- The cube size is fixed once at creation and never changed by setQuality, because envMapCubeUVHeight is in the program key (WebGLPrograms.js:64 and :447).

Light rules:
- Keep exactly one DirectionalLight (sun by day, moon at night), one HemisphereLight and the hero PointLight. Never toggle visible or castShadow on them. Light counts are in the program key (WebGLPrograms.js:341-346 and :477).
- Fade shadows through light.shadow.intensity only.
- Keep the bloom threshold fixed at 1.1 at every time of day (post.ts:73). City and landmark emissives then have one stable target. Bloom runs before tone mapping in the same EffectPass (post.ts:75), so exposure does not change what blooms.

### Corrections to the draft

- Main risk, options: replace the draft's option 1 (chained onBeforeCompile) with 'shared Float32Array uniforms injected into THREE.ShaderLib before the first compile, spread into the two ShaderMaterials (sky, sea)'. Reasons: nine existing direct onBeforeCompile assignments, and the customProgramCacheKey toString collision (Material.js:544-546).
- Main risk, consumers: state that only the sky (sky.ts:44-47) and sea (water.ts:42-46) custom shaders read the constants directly, and the fog chunks (atmosphere.ts:97-106) carry them into every fogged built-in material: city, landmark meshes and the macaw. Also name sun.ts:11-20 (shadow box and light), env/index.ts:20-27 and :47-48. The fx shaders (fxMaterial users and turbo flames) do not read the atmosphere; they are unfogged by design.
- Data shape: Lighting gains `morning` (birdsong at sunrise, so audio does not branch on the time name) and `hazeColor` (rain tint and hand-made fades). Every field is readonly, and it is the same object every frame.
- Data shape: preset `night` values are sunrise 0.05, noon 0, sunset 0.15, night 1. Consumers use their own smoothstep thresholds, so the default sunset sounds and looks as it does today.
- Data shape: Environment.sunDirection and Environment.sunColor are removed in favour of lighting. CityOptions.sunDirection is removed, since nothing in src/world reads it (main.ts:57 and dev/city.ts:48 pass it).
- Module table, rain fx: the signature is `update(dt, lighting, camera)`, not `update(dt, amount, camera)`. The tint needs hazeColor, sunColor and night, and the amount is lighting.rain.
- Module table: add a macaw row, `Macaw.applyLighting(l)` (night rim and lift, wet plumage). main row: main also drives the hero light by night and turns the menu bird toward the key light.
- Module table, audio: update() takes the AudioMix type with night, rain and morning, not just night and rain.
- Module table, env: add that the environment map (PMREM) is re-baked during blends. Otherwise wet streets and metallic rings reflect the sunset at night. Shadows fade through light.shadow.intensity; there is one key light for sun and moon.
- Module table, main: env.update moves before the lighting consumers. main runs an all-on warm-up compile behind the loader. setConditions is called only when time or rain actually changes, plus once with instant at boot.
- Constraints: add 'no real lights may be added, removed or hidden at runtime (night lights are emissive or sprites)' and 'condition-only objects must be visible-able from a Lighting value so they can be warmed up'. These are needed to meet the no-recompile rule.
- Constraints: the bloom threshold is fixed at 1.1 at every time of day. Night glows must reach at least about 1.5 in raw radiance. Exposure is applied after bloom.
- Presets: the sunset row must equal today's constants, so the default look does not change. Noon elevation is clamped to 60 deg or less, not the real Tel Aviv value. The noon rainbow is deliberately unphysical: antisolar elevation clamped to -12 deg or higher.
- Data shape: Settings is `Settings extends Conditions` (flat), defaulting to sunset and dry. Rain persists and the rainbow does not.

### Risks and mitigations

- The ShaderLib injection relies on cloneUniforms copying non-three values by reference (UniformsUtils.js:63-65; Float32Array is neither isThreeObject nor Array.isArray). Mitigation: a dev assert after the first frame that a fogged MeshStandardMaterial's uAtmoSunDir value is the same object (===) as the shared array. Add a short comment in atmosphere.ts naming the dependency; three is pinned at 0.186.1.
- A shared value that is a Color or Vector3, or a Float32Array that gets reassigned, is cloned or detached per material and silently freezes. Mitigation: atmosphereUniforms is built by one factory that only creates Float32Array values, and the writer only ever calls toArray(arr). Type it as Record<string, { readonly value: Float32Array }>.
- A fogged material that compiles before installAtmosphericFog reads its haze uniforms as zero, so the haze goes black. Mitigation: createEnvironment stays the first thing that creates or renders materials (main.ts:54 already runs before :57). Never call renderer.compile before it.
- Condition-only objects (lamps, lanterns, gan lights, halos, burners, rain, splashes) compile on their first visible draw: the first T or R press mid-flight would hitch. Mitigation: their visibility is a pure function of the Lighting passed in, and main runs the all-on warm-up with compileAsync behind the loader. Verify that renderer.info.programs.length is unchanged across switches.
- Any change in light count, or toggling light visible or castShadow, recompiles every lit program (WebGLPrograms.js:341-346, :477). Mitigation: one DirectionalLight for sun and moon, one hemi, and a hero light that is never hidden. Every night light is emissive geometry or an additive sprite. Code-review rule: no `new THREE.*Light` outside env and main.
- Program-key flags flipped at runtime recompile: transparent, fog, map null->texture, alphaTest 0->x, defines, plumage clearcoat leaving 0, sheen reaching 0, env cube size (envMapCubeUVHeight, WebGLPrograms.js:64), or scene.environment or scene.fog replaced (WebGLRenderer.js:2484). Mitigation: set them all at creation; the env cube size is fixed per session; only density and intensity values change.
- onBeforeCompile closures with baked literals collide on the toString cache key (Material.js:544-546). This is already a live bug in backlitFabric (parts.ts:89-95). Mitigation: every per-material variation goes through a uniform; the landmarks workstream fixes backlitFabric.
- Env map rebake cost on iPad is unmeasured (a guess: a few ms). Mitigation: throttle by tier, bake only while blending or while overcast changes, keep the cube size fixed (128 when created on low), and run one explicit fromCubemap outside the render pass. If it is still too slow on low, fall back to scaling environmentIntensity per preset and baking only at blend end.
- Key light swapping sun to moon swings shadows and glitter. Mitigation: the intensity envelope |1-2w| swaps direction at zero intensity, and shadow.intensity dips with it. The true sun stays a separate internal direction for sky, haze and rainbow.
- Noon at a real Tel Aviv elevation (up to about 81 deg) breaks atmoSunSide's normalize(SUN_DIR.xz) (atmosphere.ts:58) and the low-sun shadow-box assumptions (sun.ts:8-13). Mitigation: noon elevation is clamped to 60 deg or less, plus a GLSL length guard; sun.setDirection recomputes the box.
- The rainbow at noon is physically below the horizon. Mitigation: the antisolar elevation is clamped to -12 deg or higher, deliberately unphysical, and the product owner is told. The bow is always opposite the sun, so the toast could say 'look away from the sun' (optional).
- Night readability: the blue back of the bird against a deep blue sky, the gan beam much dimmer than the school beam (about 0.43 vs 0.76 luminance), and sign text smeared by bloom. Mitigation: macaw rim and lift, hero light up to 8 and 10 m, beacon boost normalized by luminance, sign board at 1.2x or less with the glow in a separate halo, night exposure about 1.4 and a raised hemi. Verified by the screenshot checklist across all 8 combinations.
- Bloom runs before tone mapping (post.ts:75), so per-time exposure does not change what blooms, while lowering the threshold would retune every emissive. Mitigation: the threshold stays fixed at 1.1 for all times, and city and landmarks target raw radiance at or above about 1.5 for glows. Rain streaks stay at or below 0.35.
- setQuality rebuilds the composer (env/index.ts:60-63) and drops per-time post state. Mitigation: re-apply grade, AO color, exposure and speed after buildPost. The quality-change hitch already exists and is outside the switch rule, but auto-downgrade mid-flight remains a hitch.
- iPads start on medium (main.ts:19-23) and only reach low through the one-way fps<40 downgrade. Mitigation: rain, lamps and stars scale by tier, and rain.setQuality is wired at both main.ts:127 and :255. Test on an iPad at medium with night plus rain, the heaviest combination.
- Lighting is one frame stale for consumers if env.update stays after them (main.ts:236-243). Mitigation: move env.update up, as in mainWiring.
- applySettings fires on every settings change (main.ts:123-129), so toggling sound could restart a blend or retrigger the rainbow. Mitigation: main edge-triggers on time|rain, and env.setConditions is idempotent against its current target.
- Removing CityOptions.sunDirection and Environment.sunDirection/sunColor breaks dev/city.ts:48 (an excess-property error), dev/ui.ts:101 (the old audio.update shape) and the test/flight.test.ts:15 literal. tsconfig includes dev (tsconfig.json:14). Mitigation: each is assigned to a workstream (city, ui, ui), and the integrator runs whole-repo tsc before merge.
- The UI's start-screen pickers change env live behind the menu while the bird may be backlit. Mitigation: the menu bird yaw eases toward lighting.sunDirection.
- Rain streaks show hard cut lines where they cross roofs (no depth texture in the transparent pass), and the speed blur smears them. Mitigation: thin, faint streaks with an edge fade, and alpha reduced by the speed-effect amount (optional).

### main.ts wiring

The integrator owns src/main.ts and src/contracts.ts.
- Land contracts.ts first. Workstreams branch from that commit, and whole-repo tsc goes green only after the integrator merges.

Boot, in order:
- `const env = createEnvironment(...)` (main.ts:54), then immediately `env.setConditions(ui.settings, { instant: true })`. The first frame is then already the saved time, with no sunset flash.
- `createCity(data, { scene, quality })` (main.ts:57; the sunDirection option is removed).
- Landmarks, audio and flames as today. After `world` is defined (main.ts:68-75), create the rain from the merged surfaceAt, so splashes also land on the gan:
```ts
const rain = createRain({ quality, surfaceAt: (x, z, b) => world.surfaceAt(x, z, b) });
scene.add(rain.object);
```
- Menu bird: keep main.ts:97 for the initial placement.

Warm-up before the first frame, replacing main.ts:264-265, behind the loader:
```ts
const ALL_ON: Lighting = { sunDirection: new THREE.Vector3(0, 1, 0), sunColor: new THREE.Color(1, 1, 1), hazeColor: new THREE.Color(0.5, 0.5, 0.5), night: 1, morning: 1, rain: 1, wetness: 1, overcast: 1, rainbow: 1 };
city.applyLighting(ALL_ON); landmarks.applyLighting(ALL_ON); macaw.applyLighting(ALL_ON); rain.update(0, ALL_ON, camera);
await renderer.compileAsync(scene, camera); // compile() walks only visible objects (WebGLRenderer.js:1396-1430)
ui.setLoading(1);
frame(); // the first frame re-applies the real env.lighting
```
- The scarlet macaw still compiles lazily on species selection, as today, in the menu. Optionally create both species and warm them up too.

Settings, edge-triggered so mute, music and quality changes never restart a blend:
```ts
let condKey = `${ui.settings.time}|${ui.settings.rain}`;
const applySettings = () => {
  audio.setMuted(ui.settings.muted); audio.setMusic(ui.settings.music);
  const k = `${ui.settings.time}|${ui.settings.rain}`;
  if (k !== condKey) { condKey = k; env.setConditions(ui.settings); }
  const q = ui.settings.quality === 'auto' ? detectQuality() : ui.settings.quality;
  if (q !== quality) { quality = q; env.setQuality(q); city.setQuality(q); flames.setQuality(q); rain.setQuality(q); }
};
```
- The auto-downgrade at main.ts:255 also calls `rain.setQuality(quality)`.
- The UI's own rAF poll (ui/index.ts:51-52) runs before frame(), consumes cycleTime and toggleRain, and fires onSettings. main never reads those flags.

frame(), new order:
1. dt (unchanged).
2. Phase block (main.ts:198-234), unchanged except the menu bird. In menu, ease player.yaw toward `atan2(-L.sunDirection.x, -L.sunDirection.z)` at about 1 rad/s, using last frame's lighting. Re-place with `player.placeOnGround(START[0], START[1], yaw, world)` when the change is above 1e-3. That calls syncQuaternion (controller.ts:64-70), and the orbit camera at :203 follows the yaw. For sunset this gives about 1.83 rad against today's π/2, close to the current framing.
3. `env.update(dt, player.position)`, moved up from main.ts:243 so lighting is current for every consumer. Shadow focus and camera are final by now (chase.update at :232).
4. Lighting consumers, in every phase (paused included, so the pause and start pickers preview live):
```ts
const L = env.lighting;
city.applyLighting(L); landmarks.applyLighting(L); macaw.applyLighting(L);
heroLight.intensity = THREE.MathUtils.lerp(3, 8, L.night); heroLight.distance = THREE.MathUtils.lerp(7, 10, L.night); // never .visible = false
heroLight.position.copy(heroOffset).applyQuaternion(camera.quaternion).add(camera.position);
rain.update(dt, L, camera);
```
5. If not paused: setSpeedEffect, then `audio.update({ ...existing fields, night: L.night, rain: L.rain, morning: L.morning })`, then landmarks.update (existing main.ts:236-241).
6. city.update(camera), env.render(dt), input.endFrame() (unchanged).
7. Auto-quality block, now including rain.setQuality.

DEV global (main.ts:266): add rain and a `setConditions(c)` passthrough for verification scripts.

### Verification plan

Setup
- Use the real game: `npm run dev` for the DEV hooks, and `npm run build` plus preview for perf, in desktop Chrome on an M-series Mac. Do not use headless Chrome for timing, because it is vsync-locked at 16.7 ms, as the perf scout found.
- Add to window.game: rain and setConditions.
- Install a frame logger: rAF deltas plus a PerformanceObserver for 'long-animation-frame', recording the max frame time inside a window starting 100 ms before each switch and lasting 6 s.
- Record programs = renderer.info.programs.length after warm-up, and draw calls with the perf scout's probe (/private/tmp/claude-501/-Users-nirn-Projects-personal-flying-game/34b765dc-fcfd-4e99-b811-ae95540f4946/scratchpad/probe/count.mjs).

A. Static: all 8 combinations ({sunrise, noon, sunset, night} x {dry, rain})
- Reach each one with setConditions(c, {instant:true}), then let wetness settle for 25 s.
- Capture screenshots from four fixed cameras: the menu bird close-up; chase cam over Gordon beach at 67 m heading east (city) and heading west (sea and sun); 1.5 km from the school with the beacon in view; 300 m from the gan.
- Check per combination:
  1. Sky: sun or moon position matches the preset. Sunrise is over the city in the east, sunset over the sea in the west, noon high in the south, and the moon at night. Stars only at night. Overcast clouds when raining.
  2. Shadows fall away from the key light. They are faint under rain and soft at night.
  3. Sea: glitter under the sun or moon, darker and rougher in rain, with rain rings.
  4. City: windows dark by day, a few lit at sunset, many and varied at night. Lamps and pools at night only. In rain, wet streets and roofs show reflections in the time's own sky color, never orange at night.
  5. Bird: clearly visible from behind against the sky at all 8. At night the rim is visible.
  6. Both places: beacons visible from 1.5 km, gan as bright as school, sign text readable, rings visible.
  7. Landmarks at night: gan lights, boat lanterns, balloon burners. Gulls perched in rain and at night, flying otherwise.
  8. Rain: streaks around the bird and splashes on roofs while raining, none in the sea, none while dry.
  9. Audio: crickets only at night and dry, birdsong only at sunrise and dry, rain hiss in rain, darker music at night, sunset dry identical to today.
  10. Sunset dry matches a screenshot from the current build within a small tolerance (regression).

B. Transitions
- All 12 ordered time pairs through the pickers, plus the T cycle (sunrise -> noon -> sunset -> night -> sunrise). Rain on and rain off at each of the 4 times.
- Expected:
  - A smooth blend over about 4 s with no pop.
  - At a day<->night swap, the key light dims to near zero before shadows change direction.
  - A rainbow appears after rain stops at sunrise, noon and sunset, opposite the sun. It lasts about 40 s and fades. It never appears at night.
  - Rain-off toast text matches what is shown.
- Stress cases:
  - Spam T 10 times in 2 s: it re-targets from the current state with no jumps.
  - Toggle R mid time-blend.
  - Press T while paused, and on the start screen: the pickers stay in sync and the background preview blends.
  - A quality change at night in rain (pause menu and forced auto-downgrade): post state is re-applied (grade and exposure stay at night values).
  - Reload: the saved time and rain are on the first frame (no sunset flash).
  - Old localStorage without the new fields loads with the defaults.
  - Gamepad D-pad and held-key repeat produce one change per press.

C. No-recompile and hitch budget
- programs stays constant across 40 randomized switches, including the first night and first rain of the session.
- Max frame time inside every switch window stays at or below 50 ms on M-series. Report the worst value and the p99.
- Time the env bake directly: performance.now around cubeCam.update + fromCubemap with gl.finish in dev. Expect 3 ms or less on M-series.
- Run the dev assert that the shared uniform is identical (===) across materials.

D. Steady-state performance (each tier: high, medium, low)
- Measure fps and frame-time p50/p95 in a scripted 60 s flight path (beach -> city -> school) for sunset dry (baseline), night dry, noon rain and night rain.
- Pass: within 10% of baseline on M-series at high, and night rain on low at no worse than baseline minus about 1 ms.
- Draw calls: at most 5 more than the baseline of about 134 on low and 182 on high (rain +2, lamps +1-2, landmark night extras about +6 at night only).
- CPU: applyLighting for city, landmarks and macaw plus rain.update under 0.1 ms per frame in total (performance.now sampling).

E. iPad (real device, Safari)
- Start at the detected medium tier, and also force low.
- Fly night plus rain for 3 minutes. Confirm no stall on T or R.
- Confirm the auto-downgrade behaves, and that after a downgrade rain counts drop (rain.setQuality wired).
- Check fill-rate when flying low along an arterial at night (lamp sprites plus rain).
- Do the readability checks of A.5 and A.6 on the device screen.

F. Build hygiene
- Whole-repo `tsc --noEmit` covers src and dev.
- The node flight test passes.
- Each dev harness (env, city, landmarks, macaw, ui, rain) has time, night, rain and wet controls and loads without errors.
