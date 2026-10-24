import { addToHomeIcon, shareIcon } from './art';
import { bilingual, el } from './dom';
import { UI_TEXT } from './strings';

const SEEN_KEY = 'macaw-sky-tlv:install-hint';

const isIosSafari = () => {
  const ua = navigator.userAgent;
  const ios = /iP(hone|od|ad)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
};
const isInstalled = () => (navigator as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;

const seen = () => { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } };
const remember = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: it may show again next visit */ } };

/**
 * One-time sheet that teaches "Share, then Add to Home Screen", so the game can run full screen from the home screen.
 * Returns a hide for when flight starts; only "Got it" remembers that it was seen.
 */
export function showInstallHint(parent: HTMLElement, force: boolean): () => void {
  if (!force && (!isIosSafari() || isInstalled() || seen())) return () => {};
  const sheet = el('div', 'mc-install');
  sheet.innerHTML = `
    <div class="mc-install-card mc-glass" role="dialog" aria-label="${UI_TEXT.installTitle.en}">
      <div class="mc-install-title mc-bi">${bilingual(UI_TEXT.installTitle)}</div>
      <ol class="mc-install-steps">
        <li><span class="mc-install-icon">${shareIcon}</span><span class="mc-bi">${bilingual(UI_TEXT.installShare)}</span></li>
        <li><span class="mc-install-icon">${addToHomeIcon}</span><span class="mc-bi">${bilingual(UI_TEXT.installAdd)}</span></li>
      </ol>
      <button class="mc-install-ok"><span class="mc-bi">${bilingual(UI_TEXT.gotIt)}</span></button>
    </div>`;
  parent.append(sheet);
  const hide = () => {
    sheet.classList.add('leaving');
    setTimeout(() => sheet.remove(), 400);
  };
  sheet.querySelector('.mc-install-ok')!.addEventListener('click', () => { remember(); hide(); });
  return hide;
}
