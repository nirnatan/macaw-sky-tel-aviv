import type { Input, PlayerName, Species, StartChoice } from '../contracts';
import { avatarArt, checkIcon, macawCardArt } from './art';
import { bilingual, el } from './dom';
import { NAMES_BANNER, PLAYERS, SPECIES, TITLE, UI_TEXT } from './strings';

const LETTER_COLORS = ['#ff6b4a', '#ffb627', '#26c6a0', '#4aa3ff', '#ff7eb6', '#9b6bff'];
const SPARKLES: [number, number, number][] = [[12, 8, 0], [86, 10, .6], [30, 30, 1.2], [70, 26, 1.8], [50, 4, .9], [94, 34, 1.5], [5, 28, 2.1]];

const KEY_GUIDE: { keys: string[]; he: string; en: string }[] = [
  { keys: ['↑', '←', '↓', '→', 'WASD'], he: 'כיוון', en: 'steer' },
  { keys: ['Space'], he: 'כנפיים', en: 'flap' },
  { keys: ['Shift'], he: 'טורבו', en: 'boost' },
  { keys: ['L'], he: 'נחיתה', en: 'land' },
  { keys: ['X'], he: 'קריאה', en: 'squawk' },
  { keys: ['Q', 'E'], he: 'גלגול', en: 'roll' },
];

const guideHtml = () => `
  <div class="mc-guide-keys mc-guide">${KEY_GUIDE.map((g) => `<span class="mc-guide-item">${g.keys.map((k) => `<kbd>${k}</kbd>`).join('')}<small><span class="mc-he" dir="rtl">${g.he}</span> <span class="mc-en" dir="ltr">${g.en}</span></small></span>`).join('')}</div>
  <div class="mc-guide mc-guide-touch">
    <span class="mc-guide-item"><span class="mc-pad"><i></i></span><small><span class="mc-he" dir="rtl">הטיה</span> <span class="mc-en" dir="ltr">steer</span></small></span>
    <span class="mc-guide-item"><span class="mc-dots"><i></i><i></i><i></i><i></i></span><small><span class="mc-he" dir="rtl">כפתורים</span> <span class="mc-en" dir="ltr">buttons</span></small></span>
  </div>`;

const choiceButton = (className: string, data: string, art: string, label: { he: string; en: string }) =>
  `<button class="mc-choice ${className}" ${data} aria-pressed="false"><span class="mc-tick">${checkIcon}</span><span class="mc-art">${art}</span><span class="mc-label"><span class="mc-he" lang="he" dir="rtl">${label.he}</span><span class="mc-en" lang="en" dir="ltr">${label.en}</span></span></button>`;

export function createStartScreen(parent: HTMLElement, initial: StartChoice, input: Input, remember: (c: StartChoice) => void) {
  const screen = el('div', 'mc-start');
  screen.hidden = true;
  const letters = [...NAMES_BANNER.he].map((ch, i) => (ch === ' ' ? '<span class="mc-gap"></span>' : `<span style="--c:${LETTER_COLORS[i % LETTER_COLORS.length]};--d:${(i * 0.12).toFixed(2)}s">${ch}</span>`)).join('');
  screen.innerHTML = `
    <header class="mc-head">
      <h1 class="mc-title">${bilingual(TITLE)}</h1>
      <div class="mc-names"><div class="mc-names-row" lang="he" dir="rtl">${letters}</div><span class="mc-en" dir="ltr">${NAMES_BANNER.en}</span></div>
      ${SPARKLES.map(([x, y, d]) => `<i class="mc-sparkle" style="left:${x}%;top:${y}%;animation-delay:${d}s"></i>`).join('')}
    </header>
    <section class="mc-side mc-glass">
      <h2 class="mc-bi">${bilingual(UI_TEXT.whoFlies)}</h2>
      ${(['Amit', 'Or'] as PlayerName[]).map((p) => choiceButton('mc-player', `data-player="${p}"`, avatarArt(p), PLAYERS[p])).join('')}
    </section>
    <section class="mc-side mc-glass">
      <h2 class="mc-bi">${bilingual(UI_TEXT.pickBird)}</h2>
      ${(['blueGold', 'scarlet'] as Species[]).map((s) => choiceButton('mc-bird', `data-species="${s}"`, macawCardArt(s), SPECIES[s])).join('')}
    </section>
    <footer class="mc-foot">
      <button class="mc-play">${bilingual(UI_TEXT.play)}</button>
      ${guideHtml()}
    </footer>`;
  screen.querySelector<HTMLElement>('.mc-title .mc-he')!.dataset.text = TITLE.he;
  parent.append(screen);

  const choice = { ...initial };
  const playerButtons = [...screen.querySelectorAll<HTMLButtonElement>('[data-player]')];
  const speciesButtons = [...screen.querySelectorAll<HTMLButtonElement>('[data-species]')];
  const refresh = () => {
    for (const b of playerButtons) b.setAttribute('aria-pressed', String(b.dataset.player === choice.player));
    for (const b of speciesButtons) b.setAttribute('aria-pressed', String(b.dataset.species === choice.species));
  };

  return {
    show(onPreview: (c: StartChoice) => void): Promise<StartChoice> {
      return new Promise((resolve) => {
        const preview = () => { refresh(); onPreview({ ...choice }); };
        const play = () => {
          window.removeEventListener('keydown', onKey);
          remember({ ...choice });
          screen.classList.add('leaving');
          setTimeout(() => { screen.hidden = true; }, 500);
          input.setTouchControlsVisible(true);
          resolve({ ...choice });
        };
        const onKey = (e: KeyboardEvent) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); play(); } };

        playerButtons.forEach((b) => b.addEventListener('click', () => { choice.player = b.dataset.player as PlayerName; preview(); }));
        speciesButtons.forEach((b) => b.addEventListener('click', () => { choice.species = b.dataset.species as Species; preview(); }));
        screen.querySelector('.mc-play')!.addEventListener('click', play);
        window.addEventListener('keydown', onKey);

        input.setTouchControlsVisible(false);
        screen.classList.remove('leaving');
        screen.hidden = false;
        preview();
      });
    },
  };
}
