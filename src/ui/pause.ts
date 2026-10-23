import type { Quality, Settings } from '../contracts';
import { bilingual, el } from './dom';
import { QUALITY_LABELS, UI_TEXT } from './strings';

const QUALITY_OPTIONS: (Quality | 'auto')[] = ['auto', 'low', 'medium', 'high'];

export function createPauseMenu(parent: HTMLElement, settings: Settings, handlers: { onResume: () => void; onChange: () => void }) {
  const overlay = el('div', 'mc-pause');
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="mc-pause-panel mc-glass" role="dialog" aria-modal="true">
      <h2 class="mc-bi">${bilingual(UI_TEXT.paused)}</h2>
      <button class="mc-big-btn primary" data-act="resume"><span class="mc-bi">${bilingual(UI_TEXT.resume)}</span></button>
      <button class="mc-big-btn" data-act="sound" aria-pressed="true"><span class="mc-bi">${bilingual(UI_TEXT.sound)}</span><span class="mc-switch"></span></button>
      <button class="mc-big-btn" data-act="music" aria-pressed="true"><span class="mc-bi">${bilingual(UI_TEXT.music)}</span><span class="mc-switch"></span></button>
      <div class="mc-quality">
        <span class="mc-bi">${bilingual(UI_TEXT.quality)}</span>
        <div class="mc-seg">${QUALITY_OPTIONS.map((q) => `<button data-quality="${q}" aria-pressed="false">${bilingual(QUALITY_LABELS[q])}</button>`).join('')}</div>
      </div>
    </div>`;
  parent.append(overlay);

  const soundButton = overlay.querySelector<HTMLElement>('[data-act="sound"]')!;
  const musicButton = overlay.querySelector<HTMLElement>('[data-act="music"]')!;
  const qualityButtons = [...overlay.querySelectorAll<HTMLElement>('[data-quality]')];
  const refresh = () => {
    soundButton.setAttribute('aria-pressed', String(!settings.muted));
    musicButton.setAttribute('aria-pressed', String(settings.music));
    for (const b of qualityButtons) b.setAttribute('aria-pressed', String(b.dataset.quality === settings.quality));
  };

  overlay.querySelector('[data-act="resume"]')!.addEventListener('click', handlers.onResume);
  soundButton.addEventListener('click', () => { settings.muted = !settings.muted; refresh(); handlers.onChange(); });
  musicButton.addEventListener('click', () => { settings.music = !settings.music; refresh(); handlers.onChange(); });
  qualityButtons.forEach((b) => b.addEventListener('click', () => { settings.quality = b.dataset.quality as Settings['quality']; refresh(); handlers.onChange(); }));

  return {
    get isOpen() { return !overlay.hidden; },
    set open(open: boolean) { if (open) refresh(); overlay.hidden = !open; },
  };
}
