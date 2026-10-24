import type { Quality } from '../contracts';

export interface Tier {
  maxPixelRatio: number;
  shadowMapSize: number;
  shadowRadius: number; // PCF filter radius in shadow-map texels
  shadowEvery: number; // frames per shadow-map render; between renders the stale map and its matrix still agree
  ao: { halfRes: boolean; mode: 'Performance' | 'Low' | 'Medium' } | null;
  bloomLevels: number;
  bloomScale: number; // bright-pass resolution relative to the frame
  antialias: 'smaa' | 'fxaa';
  detail: boolean; // second cloud octave in the sky and cloud reflections in the sea
  starDensity: number; // fraction of sky cells that hold a star at night
  bakeEvery: number; // frames between environment-map bakes while the lighting changes
}

export const TIERS: Record<Quality, Tier> = {
  high: { maxPixelRatio: 2, shadowMapSize: 4096, shadowRadius: 2.5, shadowEvery: 1, ao: { halfRes: false, mode: 'Medium' }, bloomLevels: 8, bloomScale: 1, antialias: 'smaa', detail: true, starDensity: 0.4, bakeEvery: 6 },
  medium: { maxPixelRatio: 1.5, shadowMapSize: 2048, shadowRadius: 2, shadowEvery: 1, ao: { halfRes: true, mode: 'Performance' }, bloomLevels: 6, bloomScale: 1, antialias: 'smaa', detail: true, starDensity: 0.32, bakeEvery: 10 },
  low: { maxPixelRatio: 2, shadowMapSize: 1024, shadowRadius: 1.5, shadowEvery: 2, ao: null, bloomLevels: 4, bloomScale: 0.5, antialias: 'fxaa', detail: false, starDensity: 0.22, bakeEvery: 15 },
};
