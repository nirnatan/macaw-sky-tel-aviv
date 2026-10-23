import { flyingMacawSilhouette } from './art';
import { bilingual, el } from './dom';
import { UI_TEXT } from './strings';

export function createLoader(parent: HTMLElement) {
  const loader = el('div', 'mc-loader');
  loader.hidden = true;
  loader.innerHTML = `
    <div class="mc-loader-inner">
      <div class="mc-loader-title mc-he" dir="rtl">תוכי בשמי תל אביב</div>
      <div class="mc-loader-track">
        <div class="mc-loader-bar"><div class="mc-loader-fill"></div></div>
        <div class="mc-loader-bird">${flyingMacawSilhouette}</div>
      </div>
      <div class="mc-loader-label mc-bi">${bilingual(UI_TEXT.loading)}</div>
    </div>`;
  parent.append(loader);
  const fill = loader.querySelector<HTMLElement>('.mc-loader-fill')!;
  const bird = loader.querySelector<HTMLElement>('.mc-loader-bird')!;
  const label = loader.querySelector<HTMLElement>('.mc-loader-label')!;
  let hideTimer = 0;

  return (progress: number, text?: string) => {
    clearTimeout(hideTimer);
    const p = Math.min(1, Math.max(0, progress));
    if (text) label.textContent = text;
    if (p >= 1) {
      fill.style.width = '100%'; bird.style.left = '100%';
      loader.classList.add('done');
      hideTimer = window.setTimeout(() => { loader.hidden = true; }, 800);
      return;
    }
    loader.hidden = false;
    loader.classList.remove('done');
    fill.style.width = `${p * 100}%`;
    bird.style.left = `${p * 100}%`;
  };
}
