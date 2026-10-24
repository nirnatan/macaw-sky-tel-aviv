// Interfaces between game modules. Each module owns its implementation file(s); main.ts wires them.
// World frame (src/geo.ts): meters, +x east, +z south, +y up. Sea level / ground is y = 0.
import type * as THREE from 'three';
import type { CityData, Ring } from './world/data';
import type { TargetId } from './places';

export type { TargetId };

export type Quality = 'low' | 'medium' | 'high';

// ---------- Time of day and weather (env produces Lighting; city, landmarks, macaw, rain, audio and main read it) ----------
export const TIMES = ['sunrise', 'noon', 'sunset', 'night'] as const;
export type TimeOfDay = (typeof TIMES)[number];
export interface Conditions { time: TimeOfDay; rain: boolean }

/**
 * Blended every frame by Environment.update(). The same object, with the same Vector3/Color instances, every frame.
 * Consumers only read it and never branch on the time name; every difference comes from the env preset table.
 */
export interface Lighting {
  /** Unit vector toward the key light: the sun by day, the moon at night. Swaps mid-blend while sunColor is near black. */
  readonly sunDirection: THREE.Vector3;
  /** Key light color times intensity, linear. Dips toward black at the midpoint of a day<->night blend. */
  readonly sunColor: THREE.Color;
  /** Linear haze color away from the sun: rain streak tint and hand-made distance fades. */
  readonly hazeColor: THREE.Color;
  /** 0 day .. 1 full night. Preset rows: sunrise 0.05, noon 0, sunset 0.15, night 1. Consumers apply their own smoothstep. */
  readonly night: number;
  /** 0..1: 1 on the sunrise row, 0 elsewhere (birdsong). */
  readonly morning: number;
  /** 0..1 rain intensity; ramps over about 5 s. */
  readonly rain: number;
  /** 0..1 surface wetness; rises behind rain, dries about 20 s after it stops. */
  readonly wetness: number;
  /** 0..1 cloud cover; rain pushes it up. */
  readonly overcast: number;
  /** 0..1; rises after rain stops while the sun is up, holds, then fades. */
  readonly rainbow: number;
}

// ---------- Environment: sky, sun, water, fog, shadows, post-processing (src/env/) ----------
export interface EnvironmentOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sea: Ring; // sea polygon from CityData
  quality: Quality;
}
export interface Environment {
  readonly lighting: Lighting;
  /**
   * Sets the target conditions. A call equal to the current target is a no-op (no blend restart, no rainbow retrigger).
   * The time blends over about 4 s, re-targeting from the current blended state; rain, wetness and rainbow follow their own rates.
   * `instant` snaps everything (boot, behind the loader). Never recompiles a shader or adds, removes or hides a light.
   */
  setConditions(c: Conditions, opts?: { instant?: boolean }): void;
  /** Blends lighting, keeps the shadow frustum around `focus` (the bird), advances water and clouds, refreshes the env map while blending. */
  update(dt: number, focus: THREE.Vector3): void;
  /** Renders the frame through the post-processing chain. Replaces renderer.render. */
  render(dt: number): void;
  setSize(width: number, height: number): void;
  setQuality(q: Quality): void;
  /** Speed effects driven by the game: 0..1 (boost/dive motion blur or speed lines strength). */
  setSpeedEffect(amount: number): void;
}
export type CreateEnvironment = (opts: EnvironmentOptions) => Environment;

// ---------- City: buildings, roads, parks, trees, beach (src/world/) ----------
export type SurfaceKind = 'ground' | 'roof' | 'water' | 'beach' | 'park';
export interface Surface { height: number; kind: SurfaceKind }
export interface CityOptions { scene: THREE.Scene; quality: Quality }
export interface City {
  readonly group: THREE.Group;
  /** Highest walkable surface at (x, z) at or below `belowY` (defaults to +Infinity): roof top, ground 0, or water 0. */
  surfaceAt(x: number, z: number, belowY?: number): Surface;
  /**
   * Resolves a sphere against building volumes. Returns the corrected center (pushed out of walls)
   * and the wall normal if it touched one, else null. Roofs are handled by surfaceAt, not here.
   */
  collide(center: THREE.Vector3, radius: number): THREE.Vector3 | null;
  /** Per-frame: distance-based culling / LOD around the camera. */
  update(camera: THREE.Camera): void;
  setQuality(q: Quality): void;
  /**
   * Per frame: night windows, street lamps and light pools, wet streets and roofs.
   * Writes only uniforms, material scalars, drawRange/count and visibility, never program-affecting flags.
   * Visibility of condition-only objects is a pure function of the latest `l`, so main can warm up with an all-on Lighting.
   */
  applyLighting(l: Lighting): void;
}
export type CreateCity = (data: CityData, opts: CityOptions) => City;

// ---------- Macaw: model + procedural animation (src/macaw/) ----------
export type Species = 'blueGold' | 'scarlet';
export type MacawMode = 'flap' | 'glide' | 'dive' | 'hover' | 'land' | 'walk' | 'idle';
export interface MacawAnimInput {
  mode: MacawMode;
  /** 0..1 how hard the bird is flapping (climbing / taking off = 1, cruising = ~0.4). */
  effort: number;
  /** Roll in radians (positive = right wing down). Wings and tail react asymmetrically. */
  bank: number;
  /** Pitch in radians (positive = nose up). */
  pitch: number;
  /** Ground speed in m/s while walking (drives the step cycle). */
  walkSpeed: number;
  /** -1..1 where the head looks (turn intent). */
  look: number;
}
export interface Macaw {
  /** Root group. Body center at origin, faces local -Z, +Y up, wingspan ~1.05 m, length ~0.9 m. */
  readonly object: THREE.Group;
  /** Distance from origin down to the feet when standing (place origin at surface + footOffset). */
  readonly footOffset: number;
  /** Left and right anchors at the outer tip of the longest primary feather; world transforms are current after update(). */
  readonly wingTips: readonly [THREE.Object3D, THREE.Object3D];
  update(dt: number, input: MacawAnimInput): void;
  /** One-shot gestures. */
  squawk(): void; // beak opens, head bobs
  /** Per frame: night plumage lift and cool fresnel rim; wet plumage and keratin. Uniforms and material scalars only.
   *  `menu` adds a fill on the bird alone, so the start-screen close-up reads whatever the key light does. */
  applyLighting(l: Lighting, opts?: { menu?: boolean }): void;
  dispose(): void;
}
export type CreateMacaw = (species: Species) => Macaw;

// ---------- Input (src/input/) ----------
export interface InputState {
  /** -1..1 left/right steering (turn + bank). */
  steer: number;
  /** -1..1 up/down (positive = nose up / climb). In walk mode, forward/back. */
  climb: number;
  /** -1..1 strafe while walking (A/D when walking sideways), 0 when flying. */
  strafe: number;
  /** Held: flap hard (go up / take off / speed up). */
  flap: boolean;
  /** Held: turbo boost. */
  boost: boolean;
  /** Pressed this frame: land / take off toggle. */
  landToggle: boolean;
  /** Pressed this frame: squawk. */
  squawk: boolean;
  /** Pressed this frame: barrel roll left (-1) / right (1). */
  roll: -1 | 0 | 1;
  /** Pressed this frame: pause / menu. */
  pause: boolean;
  /** Pressed this frame: next time of day (keyboard T, gamepad D-pad left/right). Consumed and cleared by the UI, like pause. */
  cycleTime: boolean;
  /** Pressed this frame: rain on/off (keyboard R, gamepad D-pad up/down). Consumed and cleared by the UI, like pause. */
  toggleRain: boolean;
  /** Last device used, so hints show the right buttons. */
  device: 'keyboard' | 'touch' | 'gamepad';
}
export interface Input {
  readonly state: InputState;
  /** Call once per frame after reading state: clears the "pressed this frame" flags. */
  endFrame(): void;
  setTouchControlsVisible(v: boolean): void;
}

// ---------- Audio (src/audio/) ----------
export interface AudioMix {
  speed: number;
  altitude: number;
  distanceToCoast: number;
  flying: boolean;
  effort: number;
  night: number; // Lighting.night: crickets and softer music (gate with smoothstep(0.3, 0.9, night) so sunset sounds as today)
  rain: number; // Lighting.rain: rain ambience; mutes birds and crickets
  morning: number; // Lighting.morning: sunrise birdsong
}
export interface AudioEngine {
  /** Must be called from a user gesture (start button). */
  unlock(): Promise<void>;
  /** Continuous mix parameters, called per frame (internally throttled). */
  update(p: AudioMix): void;
  flap(strength: number): void;
  squawk(species: Species): void;
  ring(): void; // collected a golden ring
  found(): void; // landed on a special place: big happy fanfare
  land(): void;
  setMuted(m: boolean): void;
  setMusic(on: boolean): void;
}

// ---------- UI (src/ui/) ----------
export type PlayerName = 'Amit' | 'Or';
/** Persisted. time/rain default to 'sunset' / false; old saves load with those defaults. The rainbow is never persisted. */
export interface Settings extends Conditions { muted: boolean; music: boolean; quality: Quality | 'auto' }
export interface StartChoice { player: PlayerName; species: Species }
export interface TargetHud {
  id: TargetId;
  found: boolean;
  /** Bearing relative to the bird's heading in radians (0 = straight ahead, positive = to the right). */
  bearing: number;
  distance: number; // meters (horizontal)
}
export interface HudFrame {
  speed: number; // m/s
  altitude: number; // meters above the surface under the bird
  mode: 'flying' | 'walking' | 'perched';
  targets: TargetHud[];
  player: { x: number; z: number; heading: number }; // heading: radians, 0 = north (-z), positive clockwise
  rings: { collected: number; total: number };
  hint: string | null; // contextual hint key, see ui/strings.ts
}
export interface UI {
  /** Shows the start screen; resolves when the kid presses Play. onPreview fires as they change selection. */
  showStart(onPreview: (c: StartChoice) => void): Promise<StartChoice>;
  showHud(visible: boolean): void;
  updateHud(f: HudFrame): void;
  /** Big celebration overlay ("Amit found David Yellin school!"). */
  celebrate(target: TargetId | 'all', player: PlayerName): void;
  toast(text: string): void;
  /** The UI owns the pause menu (opened by input.pause or a HUD button) and reports changes. */
  onPause(cb: (paused: boolean) => void): void;
  readonly settings: Settings; // persisted in localStorage
  onSettings(cb: (s: Settings) => void): void;
  setLoading(progress: number, label?: string): void; // 0..1; 1 hides the loader
}
export type CreateUI = (opts: { root: HTMLElement; data: CityData; input: Input }) => UI;

// ---------- Landmarks: the two special places, golden rings, ambient life (src/game/landmarks/) ----------
export interface LandingSpot { id: TargetId; nameHe: string; nameEn: string; position: THREE.Vector3; radius: number }
export interface Landmarks {
  readonly group: THREE.Group;
  readonly spots: LandingSpot[];
  readonly rings: { position: THREE.Vector3; collected: boolean }[];
  /** Extra walkable surfaces the landmarks add (the kindergarten building roof, playground). null = none here. */
  surfaceAt(x: number, z: number, belowY?: number): Surface | null;
  /** Returns indices of rings the bird passed through since last call (marks them collected). */
  collectRings(prev: THREE.Vector3, curr: THREE.Vector3): number[];
  setFound(id: TargetId): void;
  /** 3D fireworks / confetti burst at the spot. */
  burst(id: TargetId): void;
  update(dt: number, camera: THREE.Camera, bird: THREE.Vector3): void;
  /**
   * Per frame, before update(): night glow (beacons, signs, rings, gan lights, boat lanterns, balloon burners), rain gloss,
   * and the gulls' go-home target (the motion runs in update()). Uniforms, material scalars, counts and visibility only.
   * Visibility is a pure function of the latest `l`.
   */
  applyLighting(l: Lighting): void;
}
export type CreateLandmarks = (data: CityData, opts: { scene: THREE.Scene; quality: Quality }) => Landmarks;

// ---------- Turbo flames: golden fire streaming from the wing tips while boosting (src/fx/) ----------
export interface TurboFlames {
  /** Add to the scene once; particles live in world space so they trail behind the bird. */
  readonly object: THREE.Object3D;
  /**
   * amount: 0..1 boost strength (0 = no new flames; existing ones burn out).
   * tips: wing tip world positions this frame. velocity: the bird's world velocity in m/s.
   */
  update(dt: number, amount: number, tips: readonly [THREE.Vector3, THREE.Vector3], velocity: THREE.Vector3, camera: THREE.Camera): void;
  setQuality(q: Quality): void;
}
export type CreateTurboFlames = (opts: { quality: Quality }) => TurboFlames;

// ---------- Rain: streaks around the camera and splashes on surfaces (src/fx/rain.ts) ----------
export interface Rain {
  /** Add to the scene once. Holds the streak and splash meshes; casts no shadows; invisible while l.rain is about 0. */
  readonly object: THREE.Object3D;
  /**
   * Per frame, in every phase. Uses l.rain (amount) and l.hazeColor, l.sunColor, l.night, l.overcast (tint).
   * Streak stretching comes from the camera's frame-to-frame motion, with a teleport guard (jumps over 6 m reset it).
   */
  update(dt: number, l: Lighting, camera: THREE.PerspectiveCamera): void;
  setQuality(q: Quality): void;
}
export type CreateRain = (opts: {
  quality: Quality;
  /** main's merged world.surfaceAt (city + landmarks). Splashes skip kind 'water'; the sea shader draws its own rain rings. */
  surfaceAt: (x: number, z: number, belowY?: number) => Surface;
}) => Rain;
