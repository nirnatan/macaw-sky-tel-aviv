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
  eyeRing: string; // bare eyelid rim
  upperBeak: { base: string; tip: string; edge: string }; // edge: the dark band along the sides near the base
  lowerBeak: string;
  cere: string; // bare skin around the nostrils at the beak base
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
  back: '#2186e2',
  rump: '#3cabe0',
  belly: '#f6b826',
  nape: '#2a90e4',
  forehead: '#4f9e3e',
  cheek: '#ecbd3c',
  throat: '#161616',
  facePatch: '#f4f0e8',
  faceLines: '#1c1c1c',
  eyeRing: '#6a5f5a',
  upperBeak: { base: '#2b2727', tip: '#1a1717', edge: '#2b2727' },
  lowerBeak: '#262222',
  cere: '#3a3432',
  iris: '#ead98a',
  legs: '#5c5a58',
  primary: { base: '#1b5fd4', tip: '#1446b2', under: '#bfa044' },
  secondary: { base: '#226ad8', tip: '#1a54c0', under: '#bfa044' },
  primaryCovert: plain('#2676dc', '#c8aa4c'),
  greaterCovert: plain('#2e8adc', '#c8aa4c'),
  medianCovert: plain('#3498da', '#d4b652'),
  lesserCovert: plain('#38a0d6', '#d8ba52'),
  scapular: plain('#2a86de', '#2a86de'),
  tail: { base: '#2068d8', tip: '#30a0dc', under: '#bfa044' },
  tailCovert: plain('#38a0d6', '#ccac4e'),
};

const scarlet: Palette = {
  back: '#e2281c',
  rump: '#94caf0',
  belly: '#e8301f',
  nape: '#e2281c',
  forehead: '#e2281c',
  cheek: '#e2281c',
  throat: null,
  facePatch: '#f5f1ea',
  faceLines: '#e9c2b6',
  eyeRing: '#d6b4a8',
  upperBeak: { base: '#e6d8bc', tip: '#2b2320', edge: '#2a2422' },
  lowerBeak: '#1c1917',
  cere: '#e9d6c6',
  iris: '#e8dc9c',
  legs: '#56524f',
  primary: { base: '#2a5ad0', tip: '#1f46b4', under: '#3a3a44' },
  secondary: { base: '#2f68d8', tip: '#2656c4', under: '#3a3a44' },
  primaryCovert: plain('#3068d0', '#cc3c28'),
  greaterCovert: { base: '#f6cf3e', tip: '#48a452', under: '#cc3c28' },
  medianCovert: { base: '#f8d446', tip: '#f8d446', under: '#d8462c' },
  lesserCovert: plain('#e02a1e', '#e02a1e'),
  scapular: plain('#e2281c', '#e2281c'),
  tail: { base: '#e02a1e', tip: '#2e60cc', under: '#e64a3c' },
  tailCovert: plain('#94caf0', '#e64a3c'),
};

export const PALETTES: Record<Species, Palette> = { blueGold, scarlet };
