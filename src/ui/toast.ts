import { el } from './dom';

const MAX_VISIBLE = 3;

export function createToasts(parent: HTMLElement) {
  const stack = el('div', 'mc-toasts');
  parent.append(stack);
  return (text: string) => {
    const toast = el('div', 'mc-toast mc-glass');
    toast.dir = 'auto';
    toast.textContent = text;
    toast.addEventListener('animationend', () => toast.remove());
    stack.append(toast);
    while (stack.children.length > MAX_VISIBLE) stack.firstElementChild!.remove();
  };
}
