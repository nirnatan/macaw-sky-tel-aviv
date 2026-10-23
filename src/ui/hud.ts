import type { HudFrame, Input, TargetHud } from '../contracts';
import type { CityData } from '../world/data';
import { checkIcon, compassArrow, pauseIcon, ringIcon, targetIcon } from './art';
import { el } from './dom';
import { createMinimap } from './minimap';
import { TARGETS, UI_TEXT, formatDistance, hintHtml } from './strings';

const TARGET_IDS = ['school', 'gan'] as const;
const AHEAD_RADIANS = 0.22;

const badgeHtml = (id: (typeof TARGET_IDS)[number]) => `
  <div class="mc-badge mc-glass" data-target="${id}">
    <div class="mc-icon">${targetIcon(id)}<span class="mc-got">${checkIcon}</span></div>
    <div class="mc-name"><span class="mc-he" lang="he" dir="rtl">${TARGETS[id].he}</span><small>${TARGETS[id].en}</small></div>
  </div>`;

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Writes to the DOM only when the value changed, since updateHud runs every frame. */
const setText = (node: HTMLElement, text: string) => { if (node.textContent !== text) node.textContent = text; };
const setHtml = (node: HTMLElement, html: string) => { if (node.dataset.html !== html) { node.dataset.html = html; node.innerHTML = html; } };

export function createHud(parent: HTMLElement, data: CityData, input: Input, onPauseClick: () => void) {
  const hud = el('div', 'mc-hud pending');
  hud.hidden = true;
  hud.innerHTML = `
    <div class="mc-top-left">
      ${TARGET_IDS.map(badgeHtml).join('')}
      <div class="mc-rings mc-glass">${ringIcon}<span class="mc-ring-count">0</span><small>/ 0</small></div>
    </div>
    <div class="mc-compass mc-glass">
      <div class="mc-dial"><div class="mc-arrow">${compassArrow}</div></div>
      <div class="mc-compass-text"><span class="mc-he" lang="he" dir="rtl"></span><span class="mc-en" lang="en" dir="ltr"></span></div>
    </div>
    <button class="mc-pause-btn mc-glass" aria-label="${UI_TEXT.pauseButton.en}" tabindex="-1">${pauseIcon}</button>
    <div class="mc-readouts">
      <div class="mc-readout mc-glass"><small class="mc-he" dir="rtl">${UI_TEXT.altitude.he}</small><span class="mc-alt">0</span><small>m</small></div>
      <div class="mc-readout mc-glass"><small class="mc-he" dir="rtl">${UI_TEXT.speed.he}</small><span class="mc-spd">0</span><small>km/h</small></div>
    </div>
    <div class="mc-minimap-wrap"></div>
    <div class="mc-hint mc-glass off"><div class="mc-he" dir="rtl"></div><div class="mc-en" dir="ltr"></div></div>`;
  parent.append(hud);

  const minimap = createMinimap(data);
  hud.querySelector('.mc-minimap-wrap')!.append(minimap.element);
  const pauseButton = hud.querySelector<HTMLButtonElement>('.mc-pause-btn')!;
  pauseButton.addEventListener('click', () => { pauseButton.blur(); onPauseClick(); });

  const badges = Object.fromEntries(TARGET_IDS.map((id) => [id, hud.querySelector<HTMLElement>(`[data-target="${id}"]`)!]));
  const dial = hud.querySelector<HTMLElement>('.mc-dial')!;
  const arrow = hud.querySelector<HTMLElement>('.mc-arrow')!;
  const compassHe = hud.querySelector<HTMLElement>('.mc-compass-text .mc-he')!;
  const compassEn = hud.querySelector<HTMLElement>('.mc-compass-text .mc-en')!;
  const ringBox = hud.querySelector<HTMLElement>('.mc-rings')!;
  const ringCount = hud.querySelector<HTMLElement>('.mc-ring-count')!;
  const ringTotal = hud.querySelector<HTMLElement>('.mc-rings small')!;
  const altitude = hud.querySelector<HTMLElement>('.mc-alt')!;
  const speed = hud.querySelector<HTMLElement>('.mc-spd')!;
  const hint = hud.querySelector<HTMLElement>('.mc-hint')!;
  const hintHe = hint.querySelector<HTMLElement>('.mc-he')!;
  const hintEn = hint.querySelector<HTMLElement>('.mc-en')!;
  let lastRings = 0;
  const pop = (node: HTMLElement) => { node.classList.remove('pop'); void node.offsetWidth; node.classList.add('pop'); };

  const updateCompass = (targets: TargetHud[]) => {
    const nearest = targets.filter((t) => !t.found).sort((a, b) => a.distance - b.distance)[0];
    if (!nearest) {
      setText(compassHe, UI_TEXT.allFound.he); setText(compassEn, UI_TEXT.allFound.en);
      dial.classList.add('ahead');
      return;
    }
    const bearing = wrapAngle(nearest.bearing);
    arrow.style.transform = `rotate(${bearing}rad)`;
    dial.classList.toggle('ahead', Math.abs(bearing) < AHEAD_RADIANS);
    setText(compassHe, `${TARGETS[nearest.id].he} · ${formatDistance(nearest.distance, 'he')}`);
    setText(compassEn, `${TARGETS[nearest.id].en} · ${formatDistance(nearest.distance, 'en')}`);
  };

  return {
    element: hud,
    show(visible: boolean) {
      hud.hidden = !visible;
      if (visible) requestAnimationFrame(() => hud.classList.remove('pending'));
      else hud.classList.add('pending');
    },
    update(f: HudFrame, time: number) {
      updateCompass(f.targets);
      for (const t of f.targets) {
        const badge = badges[t.id]!;
        if (t.found && !badge.classList.contains('found')) pop(badge);
        badge.classList.toggle('found', t.found);
      }
      setText(ringCount, String(f.rings.collected));
      setText(ringTotal, `/ ${f.rings.total}`);
      if (f.rings.collected > lastRings) pop(ringBox);
      lastRings = f.rings.collected;
      setText(altitude, String(Math.max(0, Math.round(f.altitude))));
      setText(speed, String(Math.round(f.speed * 3.6)));

      const text = f.hint ? hintHtml(f.hint, input.state.device) : null;
      hint.classList.toggle('off', !text);
      if (text) { setHtml(hintHe, text.he); setHtml(hintEn, text.en); }

      minimap.draw(f, time);
    },
  };
}
