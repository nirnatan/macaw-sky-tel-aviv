import { TIMES, type PlayerName, type Quality, type Settings, type Species, type StartChoice, type TimeOfDay } from '../contracts';

const KEY = 'macaw-sky-tlv:v1';

export interface Saved { choice: StartChoice; settings: Settings }

const DEFAULTS: Saved = {
  choice: { player: 'Amit', species: 'blueGold' },
  settings: { muted: false, music: true, quality: 'auto', time: 'sunset', rain: false, tilt: false },
};

const isOneOf = <T extends string>(options: readonly T[], v: unknown): v is T => options.includes(v as T);

export function loadSaved(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<{ choice: Partial<StartChoice>; settings: Partial<Settings> }> | null;
    return {
      choice: {
        player: isOneOf<PlayerName>(['Amit', 'Or'], raw?.choice?.player) ? raw!.choice!.player! : DEFAULTS.choice.player,
        species: isOneOf<Species>(['blueGold', 'scarlet'], raw?.choice?.species) ? raw!.choice!.species! : DEFAULTS.choice.species,
      },
      settings: {
        muted: typeof raw?.settings?.muted === 'boolean' ? raw.settings.muted : DEFAULTS.settings.muted,
        music: typeof raw?.settings?.music === 'boolean' ? raw.settings.music : DEFAULTS.settings.music,
        quality: isOneOf<Quality | 'auto'>(['auto', 'low', 'medium', 'high'], raw?.settings?.quality) ? raw!.settings!.quality! : DEFAULTS.settings.quality,
        time: isOneOf<TimeOfDay>(TIMES, raw?.settings?.time) ? raw!.settings!.time! : DEFAULTS.settings.time,
        rain: typeof raw?.settings?.rain === 'boolean' ? raw.settings.rain : DEFAULTS.settings.rain,
        tilt: typeof raw?.settings?.tilt === 'boolean' ? raw.settings.tilt : DEFAULTS.settings.tilt,
      },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function persist(saved: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode: the choice just is not remembered */ }
}
