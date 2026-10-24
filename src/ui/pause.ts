import { TIMES, type Quality, type Settings, type TimeOfDay } from '../contracts';
import { bilingual, el } from './dom';
import { MAP_CREDIT, QUALITY_LABELS, TIME_LABELS, UI_TEXT } from './strings';

const QUALITY_OPTIONS: (Quality | 'auto')[] = ['auto', 'low', 'medium', 'high'];

export interface PauseHandlers {
  onResume: () => void;
  onChange: () => void;
  /** Runs inside the tap itself, so iOS can show its motion prompt. */
  onTiltTap: () => void;
}

export function createPauseMenu(parent: HTMLElement, settings: Settings, tiltSupported: boolean, handlers: PauseHandlers) {
  const overlay = el('div', 'mc-pause');
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="mc-pause-panel mc-glass" role="dialog" aria-modal="true" data-scrollable>
      <h2 class="mc-bi">${bilingual(UI_TEXT.paused)}</h2>
      <button class="mc-big-btn primary" data-act="resume"><span class="mc-bi">${bilingual(UI_TEXT.resume)}</span></button>
      <div class="mc-pause-cols">
        <div class="mc-pause-col mc-toggles">
          <button class="mc-big-btn" data-act="sound" aria-pressed="true"><span class="mc-bi">${bilingual(UI_TEXT.sound)}</span><span class="mc-switch"></span></button>
          <button class="mc-big-btn" data-act="music" aria-pressed="true"><span class="mc-bi">${bilingual(UI_TEXT.music)}</span><span class="mc-switch"></span></button>
          <button class="mc-big-btn" data-act="rain" aria-pressed="false"><span class="mc-bi">${bilingual(UI_TEXT.rain)}</span><span class="mc-switch"></span></button>
          <button class="mc-big-btn" data-act="tilt" aria-pressed="false" ${tiltSupported ? '' : 'hidden'}><span class="mc-bi">${bilingual(UI_TEXT.tilt)}</span><span class="mc-switch"></span><span class="mc-tilt-note mc-bi">${bilingual(UI_TEXT.tiltDenied)}</span></button>
        </div>
        <div class="mc-pause-col">
          <div class="mc-seg-group">
            <span class="mc-bi">${bilingual(UI_TEXT.timeOfDay)}</span>
            <div class="mc-seg">${TIMES.map((t) => `<button data-time="${t}" aria-pressed="false">${bilingual(TIME_LABELS[t])}</button>`).join('')}</div>
          </div>
          <div class="mc-seg-group">
            <span class="mc-bi">${bilingual(UI_TEXT.quality)}</span>
            <div class="mc-seg">${QUALITY_OPTIONS.map((q) => `<button data-quality="${q}" aria-pressed="false">${bilingual(QUALITY_LABELS[q])}</button>`).join('')}</div>
          </div>
        </div>
      </div>
      <div class="mc-credit" dir="ltr">${MAP_CREDIT}</div>
    </div>`;
  parent.append(overlay);

  const soundButton = overlay.querySelector<HTMLElement>('[data-act="sound"]')!;
  const musicButton = overlay.querySelector<HTMLElement>('[data-act="music"]')!;
  const rainButton = overlay.querySelector<HTMLElement>('[data-act="rain"]')!;
  const tiltButton = overlay.querySelector<HTMLElement>('[data-act="tilt"]')!;
  const timeButtons = [...overlay.querySelectorAll<HTMLElement>('[data-time]')];
  const qualityButtons = [...overlay.querySelectorAll<HTMLElement>('[data-quality]')];
  const refresh = () => {
    soundButton.setAttribute('aria-pressed', String(!settings.muted));
    musicButton.setAttribute('aria-pressed', String(settings.music));
    rainButton.setAttribute('aria-pressed', String(settings.rain));
    tiltButton.setAttribute('aria-pressed', String(settings.tilt));
    for (const b of timeButtons) b.setAttribute('aria-pressed', String(b.dataset.time === settings.time));
    for (const b of qualityButtons) b.setAttribute('aria-pressed', String(b.dataset.quality === settings.quality));
  };

  overlay.querySelector('[data-act="resume"]')!.addEventListener('click', handlers.onResume);
  soundButton.addEventListener('click', () => { settings.muted = !settings.muted; handlers.onChange(); });
  musicButton.addEventListener('click', () => { settings.music = !settings.music; handlers.onChange(); });
  rainButton.addEventListener('click', () => { settings.rain = !settings.rain; handlers.onChange(); });
  tiltButton.addEventListener('click', handlers.onTiltTap);
  timeButtons.forEach((b) => b.addEventListener('click', () => { settings.time = b.dataset.time as TimeOfDay; handlers.onChange(); }));
  qualityButtons.forEach((b) => b.addEventListener('click', () => { settings.quality = b.dataset.quality as Settings['quality']; handlers.onChange(); }));

  return {
    refresh,
    get isOpen() { return !overlay.hidden; },
    set open(open: boolean) { if (open) refresh(); overlay.hidden = !open; },
  };
}
