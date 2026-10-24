import { el } from './dom';

const MAX_VISIBLE = 3;

/** "עברית · English" (strings.toastText, or main's own toasts) shows as two stacked lines, like every other bilingual label. */
const splitBilingual = (text: string): [string, string | null] => {
  const at = text.indexOf(' · ');
  return at < 0 ? [text, null] : [text.slice(0, at), text.slice(at + 3).replace(/[\u2066\u2069]/g, '')];
};

const line = (className: string, text: string) => {
  const span = el('span', className);
  span.textContent = text;
  return span;
};

export function createToasts(parent: HTMLElement) {
  const stack = el('div', 'mc-toasts');
  parent.append(stack);
  return (text: string) => {
    const toast = el('div', 'mc-toast mc-glass');
    const [he, en] = splitBilingual(text);
    if (en) {
      toast.classList.add('mc-bi');
      toast.append(line('mc-he', he), line('mc-en', en));
    } else {
      toast.dir = 'auto';
      toast.textContent = text;
    }
    toast.addEventListener('animationend', () => toast.remove());
    stack.append(toast);
    while (stack.children.length > MAX_VISIBLE) stack.firstElementChild!.remove();
  };
}
