import { TIMES, type CreateUI, type HudFrame, type Settings, type StartChoice, type TargetId, type UI } from '../contracts';
import { createCelebrations } from './celebrate';
import { el, injectFonts } from './dom';
import { createHud } from './hud';
import { showInstallHint } from './install';
import { createLoader } from './loader';
import { createPauseMenu } from './pause';
import { createRotateHint } from './rotate';
import { createStartScreen } from './start';
import { loadSaved, persist } from './storage';
import { RAIN_TOASTS, TIME_TOASTS, UI_TEXT, toastText, type Bilingual } from './strings';
import { createToasts } from './toast';
import './ui.css';

export { HINT_KEYS, type HintKey } from './strings';

/** Dev-only URL hooks to land on a screen without tapping (the iOS Simulator cannot be tapped from scripts). */
const DEV_PARAMS = import.meta.env.DEV ? new URLSearchParams(location.search) : new URLSearchParams();
const DEV_SCREEN = DEV_PARAMS.get('ui'); // play | pause | celebrate | all

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
  let pausedByHiding = false;

  const setPaused = (paused: boolean) => {
    if (!playing || pauseMenu.isOpen === paused) return;
    pauseMenu.open = paused;
    if (!paused) input.recalibrateTilt(); // the kid may hold the phone differently after a break
    pauseListeners.forEach((cb) => cb(paused));
  };
  const settingsChanged = () => {
    persist(saved);
    pauseMenu.refresh();
    start.refreshSettings();
    settingsListeners.forEach((cb) => cb({ ...settings }));
  };

  /** Must run synchronously inside a tap: enableTilt asks iOS for motion permission. */
  const applyTilt = (on: boolean, announce: boolean) => {
    const request = input.enableTilt(on);
    settings.tilt = on;
    settingsChanged();
    void request.then((active) => {
      hud.setTiltActive(active);
      if (on && !active) {
        settings.tilt = false;
        settingsChanged();
        showTiltDenied();
      } else if (active && announce) {
        toast(toastText(UI_TEXT.tiltOn));
      }
    });
  };
  const toggleTilt = () => applyTilt(!settings.tilt, true);
  /** A still note under both tilt toggles, there long enough for a parent to read (a toast is gone in 3 s). */
  let deniedTimer = 0;
  const showTiltDenied = () => {
    container.classList.add('tilt-denied');
    clearTimeout(deniedTimer);
    deniedTimer = window.setTimeout(() => container.classList.remove('tilt-denied'), 7000);
  };

  const pauseMenu = createPauseMenu(container, settings, input.tiltSupported, { onResume: () => setPaused(false), onChange: settingsChanged, onTiltTap: toggleTilt });
  const hud = createHud(container, data, input, {
    onPause: () => setPaused(true),
    onCenterTilt: () => { input.recalibrateTilt(); toast(toastText(UI_TEXT.tiltCentered)); },
  });
  const start = createStartScreen(container, {
    initial: saved.choice, input, settings,
    remember: (choice) => { saved.choice = choice; persist(saved); },
    onConditionsChange: settingsChanged,
    onTiltTap: toggleTilt,
    onPlayTap: () => { if (settings.tilt && input.tiltSupported) applyTilt(true, false); }, // a saved "tilt on" needs this tap to get permission again
  });
  const celebrations = createCelebrations(container);
  const rotateHint = createRotateHint(container);
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
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pausedByHiding = playing && !pauseMenu.isOpen;
      setPaused(true);
    } else if (pausedByHiding) {
      pausedByHiding = false;
      setPaused(false);
    }
  });

  const runDevScreen = (choice: StartChoice) => {
    if (DEV_PARAMS.has('tiltui')) hud.setTiltActive(true);
    const later = (fn: () => void) => setTimeout(fn, 1500);
    if (DEV_SCREEN === 'pause') later(() => setPaused(true));
    if (DEV_SCREEN === 'celebrate') later(() => ui.celebrate((DEV_PARAMS.get('place') ?? 'school') as TargetId, choice.player));
    if (DEV_SCREEN === 'all') later(() => ui.celebrate('all', choice.player));
  };

  const ui: UI = {
    showStart(onPreview: (c: StartChoice) => void) {
      const chosen = start.show(onPreview);
      const hideInstallHint = DEV_SCREEN && !DEV_PARAMS.has('installhint') ? () => {} : showInstallHint(container, DEV_PARAMS.has('installhint'));
      if (DEV_SCREEN) container.querySelector<HTMLButtonElement>('.mc-play')!.click();
      return chosen.then((choice) => {
        playing = true;
        hideInstallHint();
        rotateHint.show();
        if (DEV_SCREEN) runDevScreen(choice);
        return choice;
      });
    },
    showHud: hud.show,
    updateHud(f: HudFrame) {
      pollInput();
      hud.update(f, performance.now() / 1000);
    },
    celebrate(target, player) { rotateHint.dismiss(); celebrations.celebrate(target, player); },
    toast,
    onPause: (cb) => { pauseListeners.push(cb); },
    settings,
    onSettings: (cb) => { settingsListeners.push(cb); },
    setLoading,
  };
  return ui;
};
