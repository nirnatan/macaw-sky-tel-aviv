import type { PlayerName } from '../contracts';
import { targetIcon } from './art';
import { createConfetti } from './confetti';
import { bilingual, el } from './dom';
import { celebrationText } from './strings';

const STAR_TROPHY = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 4l8.500 17.500 19 2.600-13.800 13.400 3.400 19L32 47.500 14.900 56.500l3.400-19L4.500 24.100l19-2.600z" fill="#ffd23a" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><path d="M32 12l5 11 12 1.600-8.700 8.400" fill="none" stroke="#fff7c2" stroke-width="2.500" stroke-linecap="round" opacity=".8"/></svg>`;

const DURATION_MS = { single: 5200, all: 10000 };

export function createCelebrations(parent: HTMLElement) {
  let active: { node: HTMLElement; stop: () => void } | null = null;

  const dismiss = () => { active?.stop(); active = null; };

  return {
    celebrate(target: 'school' | 'gan' | 'all', player: PlayerName) {
      dismiss();
      const { title, sub } = celebrationText(target, player);
      const node = el('div', 'mc-celebrate');
      node.innerHTML = `
        <canvas class="mc-confetti"></canvas>
        <div class="mc-cel-card">
          <div class="mc-rays"></div>
          <div class="mc-cel-icon">${target === 'all' ? STAR_TROPHY : targetIcon(target)}</div>
          <div class="mc-cel-title mc-bi">${bilingual(title)}</div>
          ${sub ? `<div class="mc-cel-sub mc-bi">${bilingual(sub)}</div>` : ''}
        </div>`;
      parent.append(node);

      const confetti = createConfetti(node.querySelector('canvas')!);
      const timers: number[] = [];
      const after = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
      const cannons = () => { confetti.burst(0.05, 1, -1.15, 70); confetti.burst(0.95, 1, -Math.PI + 1.15, 70); };
      cannons(); confetti.rain(90);
      const total = target === 'all' ? DURATION_MS.all : DURATION_MS.single;
      if (target === 'all') for (const t of [900, 1900, 3000, 4300, 5800]) after(t, () => { cannons(); confetti.rain(60); });
      else after(1200, () => confetti.rain(50));

      const card = node.querySelector('.mc-cel-card')!;
      after(total - 600, () => card.classList.add('leaving'));
      after(total, dismiss);
      active = { node, stop: () => { timers.forEach(clearTimeout); confetti.dispose(); node.remove(); } };
    },
  };
}
