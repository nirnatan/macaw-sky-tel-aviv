import { rotatePhoneArt } from './art';
import { bilingual, el } from './dom';
import { UI_TEXT } from './strings';

const AUTO_HIDE_MS = 12000;

/** A gentle "turn the phone sideways" card for portrait play. Never blocks the controls; goes away for good on rotation, tap or timeout. */
export function createRotateHint(parent: HTMLElement) {
  const card = el('div', 'mc-rotate mc-glass');
  card.hidden = true;
  card.setAttribute('role', 'status');
  card.innerHTML = `<span class="mc-rotate-art">${rotatePhoneArt}</span><span class="mc-rotate-text"><span class="mc-bi mc-rotate-main">${bilingual(UI_TEXT.rotate)}</span><span class="mc-bi mc-rotate-why">${bilingual(UI_TEXT.rotateWhy)}</span></span>`;
  parent.append(card);

  const portraitPhone = matchMedia('(orientation: portrait) and (pointer: coarse) and (max-width: 600px)');
  let done = false;
  const dismiss = () => {
    if (done) return;
    done = true;
    card.classList.add('leaving');
    setTimeout(() => { card.hidden = true; }, 400);
    portraitPhone.removeEventListener('change', onChange);
  };
  const onChange = () => { if (!portraitPhone.matches) dismiss(); };
  card.addEventListener('pointerdown', dismiss);

  return {
    dismiss,
    /** Call when flight starts. */
    show() {
      if (done || !portraitPhone.matches) return;
      card.hidden = false;
      portraitPhone.addEventListener('change', onChange);
      setTimeout(dismiss, AUTO_HIDE_MS);
    },
  };
}
