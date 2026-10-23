import type { Quality } from '../contracts';

export interface Tier {
  maxPixelRatio: number;
  shadowMapSize: number;
  shadowRadius: number; // PCF filter radius in shadow-map texels
  ao: { halfRes: boolean; mode: 'Performance' | 'Low' | 'Medium' } | null;
  bloomLevels: number;
  antialias: 'smaa' | 'fxaa';
  detail: boolean; // second cloud octave in the sky and cloud reflections in the sea
}

export const TIERS: Record<Quality, Tier> = {
  high: { maxPixelRatio: 2, shadowMapSize: 4096, shadowRadius: 2.5, ao: { halfRes: false, mode: 'Medium' }, bloomLevels: 8, antialias: 'smaa', detail: true },
  medium: { maxPixelRatio: 1.5, shadowMapSize: 2048, shadowRadius: 2, ao: { halfRes: true, mode: 'Performance' }, bloomLevels: 6, antialias: 'smaa', detail: true },
  low: { maxPixelRatio: 1, shadowMapSize: 1024, shadowRadius: 1.5, ao: null, bloomLevels: 4, antialias: 'fxaa', detail: false },
};
