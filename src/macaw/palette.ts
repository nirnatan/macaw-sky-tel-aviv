import type { Species } from '../contracts';

export interface FeatherColors {
  base: string; // color at the feather base (top side)
  tip: string; // color at the tip (top side); equal to base for a plain feather
  under: string; // bottom side
}

export interface Palette {
  back: string; // mantle and upper body
  rump: string; // lower back above the tail
  belly: string; // chest and underside
  nape: string; // back of the head and crown
  forehead: string;
  cheek: string; // feathered area just behind and below the bare patch
  throat: string | null; // dark band under the chin, null for none
  facePatch: string;
  faceLines: string | null; // thin feather lines across the bare patch
  upperBeak: { base: string; tip: string };
  lowerBeak: string;
  iris: string;
  legs: string;
  primary: FeatherColors;
  secondary: FeatherColors;
  primaryCovert: FeatherColors;
  greaterCovert: FeatherColors;
  medianCovert: FeatherColors;
  lesserCovert: FeatherColors;
  scapular: FeatherColors;
  tail: FeatherColors;
  tailCovert: FeatherColors;
}

const plain = (top: string, under: string): FeatherColors => ({ base: top, tip: top, under });

const blueGold: Palette = {
  back: '#1f63d6',
  rump: '#2b8fd0',
  belly: '#f0b322',
  nape: '#2d7ee6',
  forehead: '#4f9a3c',
  cheek: '#e6b63a',
  throat: '#141414',
  facePatch: '#f4f0e8',
  faceLines: '#1c1c1c',
  upperBeak: { base: '#2e2a2a', tip: '#1a1818' },
  lowerBeak: '#282424',
  iris: '#ead98a',
  legs: '#5c5a58',
  primary: { base: '#1448b8', tip: '#0f3a9a', under: '#b89a3e' },
  secondary: { base: '#1d5ccc', tip: '#164ab4', under: '#b89a3e' },
  primaryCovert: plain('#2068d2', '#c2a548'),
  greaterCovert: plain('#2a7cd2', '#c2a548'),
  medianCovert: plain('#2f8bd0', '#d1b24e'),
  lesserCovert: plain('#2f8fcc', '#d6b64e'),
  scapular: plain('#2470d4', '#2470d4'),
  tail: { base: '#1c5cd0', tip: '#2a84d8', under: '#b89a3e' },
  tailCovert: plain('#2f8fcc', '#c9a94a'),
};

const scarlet: Palette = {
  back: '#d4231c',
  rump: '#8fc2ec',
  belly: '#dc2a1e',
  nape: '#d4231c',
  forehead: '#d4231c',
  cheek: '#d4231c',
  throat: null,
  facePatch: '#f5f1ea',
  faceLines: null,
  upperBeak: { base: '#e3d2b4', tip: '#2b2320' },
  lowerBeak: '#1c1917',
  iris: '#e8dc9c',
  legs: '#56524f',
  primary: { base: '#2552c4', tip: '#1c3fa8', under: '#3a3a44' },
  secondary: { base: '#2b60cc', tip: '#2250b8', under: '#3a3a44' },
  primaryCovert: plain('#2d62c8', '#c53a26'),
  greaterCovert: { base: '#f0c43a', tip: '#3f9a4a', under: '#c53a26' },
  medianCovert: { base: '#f2c93e', tip: '#f2c93e', under: '#d2422a' },
  lesserCovert: plain('#d8291f', '#d8291f'),
  scapular: plain('#d4231c', '#d4231c'),
  tail: { base: '#d6281e', tip: '#2b5cc8', under: '#e0463a' },
  tailCovert: plain('#8fc2ec', '#e0463a'),
};

export const PALETTES: Record<Species, Palette> = { blueGold, scarlet };
