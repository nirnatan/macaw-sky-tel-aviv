// Interfaces between game modules. Each module owns its implementation file(s); main.ts wires them.
// World frame (src/geo.ts): meters, +x east, +z south, +y up. Sea level / ground is y = 0.
import type * as THREE from 'three';
import type { CityData, Ring } from './world/data';

export type Quality = 'low' | 'medium' | 'high';

// ---------- Environment: sky, sun, water, fog, shadows, post-processing (src/env/) ----------
export interface EnvironmentOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sea: Ring; // sea polygon from CityData
  quality: Quality;
}
export interface Environment {
  readonly sunDirection: THREE.Vector3; // unit vector from the scene toward the sun (golden hour, low in the west over the sea)
  readonly sunColor: THREE.Color;
  /** Keeps the shadow frustum around `focus` (the bird) and advances water/clouds. */
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
export interface CityOptions { scene: THREE.Scene; quality: Quality; sunDirection: THREE.Vector3 }
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
  update(dt: number, input: MacawAnimInput): void;
  /** One-shot gestures. */
  squawk(): void; // beak opens, head bobs
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
export interface AudioEngine {
  /** Must be called from a user gesture (start button). */
  unlock(): Promise<void>;
  /** Continuous mix parameters, called per frame. */
  update(p: { speed: number; altitude: number; distanceToCoast: number; flying: boolean; effort: number }): void;
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
export interface Settings { muted: boolean; music: boolean; quality: Quality | 'auto' }
export interface StartChoice { player: PlayerName; species: Species }
export interface TargetHud {
  id: 'school' | 'gan';
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
  celebrate(target: 'school' | 'gan' | 'all', player: PlayerName): void;
  toast(text: string): void;
  /** The UI owns the pause menu (opened by input.pause or a HUD button) and reports changes. */
  onPause(cb: (paused: boolean) => void): void;
  readonly settings: Settings; // persisted in localStorage
  onSettings(cb: (s: Settings) => void): void;
  setLoading(progress: number, label?: string): void; // 0..1; 1 hides the loader
}
export type CreateUI = (opts: { root: HTMLElement; data: CityData; input: Input }) => UI;

// ---------- Landmarks: the two special places, golden rings, ambient life (src/game/landmarks/) ----------
export type TargetId = 'school' | 'gan';
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
}
export type CreateLandmarks = (data: CityData, opts: { scene: THREE.Scene; quality: Quality }) => Landmarks;
