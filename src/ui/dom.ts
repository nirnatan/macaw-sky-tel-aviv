import type { Bilingual } from './strings';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', html = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html) node.innerHTML = html;
  return node;
}

/** Hebrew line (RTL) over an English line. Inputs are constants from strings.ts, never user text. */
export const bilingual = (text: Bilingual) => `<span class="mc-he" lang="he" dir="rtl">${text.he}</span><span class="mc-en" lang="en" dir="ltr">${text.en}</span>`;

export function injectFonts() {
  if (document.getElementById('mc-fonts')) return;
  const css = document.createElement('link');
  css.id = 'mc-fonts';
  css.rel = 'stylesheet';
  css.href = 'https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700;800&display=swap';
  document.head.append(css);
}
