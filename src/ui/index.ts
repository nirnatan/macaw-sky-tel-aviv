import { TIMES, type CreateUI, type HudFrame, type Settings, type StartChoice, type UI } from '../contracts';
import { createCelebrations } from './celebrate';
import { el, injectFonts } from './dom';
import { createHud } from './hud';
import { createLoader } from './loader';
import { createPauseMenu } from './pause';
import { createStartScreen } from './start';
import { loadSaved, persist } from './storage';
import { RAIN_TOASTS, TIME_TOASTS, toastText, type Bilingual } from './strings';
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
  const settingsChanged = () => {
    persist(saved);
    pauseMenu.refresh();
    start.refreshConditions();
    settingsListeners.forEach((cb) => cb({ ...settings }));
  };
  const pauseMenu = createPauseMenu(container, settings, { onResume: () => setPaused(false), onChange: settingsChanged });
  const hud = createHud(container, data, input, () => setPaused(true));
  const start = createStartScreen(container, saved.choice, input, settings, (choice) => { saved.choice = choice; persist(saved); }, settingsChanged);
  const celebrations = createCelebrations(container);
  const toast = createToasts(container);
  const setLoading = createLoader(container);

  const announce = (text: Bilingual) => { if (playing && !pauseMenu.isOpen) toast(toastText(text)); };

  const pollInput = () => {
    const state = input.state;
    container.classList.toggle('is-touch', state.device === 'touch');
    if (state.pause) {
      state.pause = false; // consumed here so the same press cannot toggle twice
      setPaused(!pauseMenu.isOpen);
    }
    if (state.cycleTime) {
      state.cycleTime = false;
      settings.time = TIMES[(TIMES.indexOf(settings.time) + 1) % TIMES.length]!;
      settingsChanged();
      announce(TIME_TOASTS[settings.time]);
    }
    if (state.toggleRain) {
      state.toggleRain = false;
      settings.rain = !settings.rain;
      settingsChanged();
      announce(settings.rain ? RAIN_TOASTS.on : settings.time === 'night' ? RAIN_TOASTS.off : RAIN_TOASTS.offRainbow);
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
