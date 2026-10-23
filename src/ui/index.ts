import type { CreateUI, HudFrame, Settings, StartChoice, UI } from '../contracts';
import { createCelebrations } from './celebrate';
import { el, injectFonts } from './dom';
import { createHud } from './hud';
import { createLoader } from './loader';
import { createPauseMenu } from './pause';
import { createStartScreen } from './start';
import { loadSaved, persist } from './storage';
import { createToasts } from './toast';
import './ui.css';

export { HINT_KEYS, type HintKey } from './strings';

export const createUI: CreateUI = ({ root, data, input }) => {
  injectFonts();
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
  const saved = loadSaved();
  const settings: Settings = saved.settings;
  const container = el('div', 'mc-ui');
  root.append(container);

  const pauseListeners: ((paused: boolean) => void)[] = [];
  const settingsListeners: ((s: Settings) => void)[] = [];
  let playing = false;

  const setPaused = (paused: boolean) => {
    if (!playing || pauseMenu.isOpen === paused) return;
    pauseMenu.open = paused;
    pauseListeners.forEach((cb) => cb(paused));
  };
  const pauseMenu = createPauseMenu(container, settings, {
    onResume: () => setPaused(false),
    onChange: () => {
      persist({ choice: saved.choice, settings });
      settingsListeners.forEach((cb) => cb({ ...settings }));
    },
  });
  const hud = createHud(container, data, input, () => setPaused(true));
  const start = createStartScreen(container, saved.choice, input, (choice) => { saved.choice = choice; persist(saved); });
  const celebrations = createCelebrations(container);
  const toast = createToasts(container);
  const setLoading = createLoader(container);

  const pollInput = () => {
    container.classList.toggle('is-touch', input.state.device === 'touch');
    if (input.state.pause) {
      input.state.pause = false; // consumed here so the same press cannot toggle twice
      setPaused(!pauseMenu.isOpen);
    }
  };
  const loop = () => { pollInput(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

  const ui: UI = {
    showStart(onPreview: (c: StartChoice) => void) {
      return start.show(onPreview).then((choice) => { playing = true; return choice; });
    },
    showHud: hud.show,
    updateHud(f: HudFrame) {
      pollInput();
      hud.update(f, performance.now() / 1000);
    },
    celebrate: celebrations.celebrate,
    toast,
    onPause: (cb) => { pauseListeners.push(cb); },
    settings,
    onSettings: (cb) => { settingsListeners.push(cb); },
    setLoading,
  };
  return ui;
};
