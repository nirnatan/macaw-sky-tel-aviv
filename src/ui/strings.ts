import type { InputState, PlayerName, Species } from '../contracts';

export interface Bilingual { he: string; en: string }
type Device = InputState['device'];

export const TITLE: Bilingual = { he: 'תוכי בשמי תל אביב', en: 'Macaw Sky · Tel Aviv' };
export const NAMES_BANNER: Bilingual = { he: 'עמית ואור', en: 'Amit & Or' };

export const PLAYERS: Record<PlayerName, Bilingual> = {
  Amit: { he: 'עמית', en: 'Amit' },
  Or: { he: 'אור', en: 'Or' },
};

export const SPECIES: Record<Species, Bilingual> = {
  blueGold: { he: 'ארה כחול-צהוב', en: 'Blue & Gold Macaw' },
  scarlet: { he: 'ארה אדום', en: 'Scarlet Macaw' },
};

export const TARGETS: Record<'school' | 'gan', Bilingual> = {
  school: { he: 'ביה״ס דוד ילין', en: 'David Yellin School' },
  gan: { he: 'גן הדר', en: 'Gan Hadar' },
};

export const UI_TEXT = {
  whoFlies: { he: 'מי עף היום?', en: "Who's flying?" },
  pickBird: { he: 'בחר ארה', en: 'Pick your macaw' },
  play: { he: 'יאללה, עפים!', en: "Let's fly!" },
  paused: { he: 'הפסקה', en: 'Paused' },
  resume: { he: 'להמשיך לעוף', en: 'Keep flying' },
  sound: { he: 'צלילים', en: 'Sound' },
  music: { he: 'מוזיקה', en: 'Music' },
  quality: { he: 'איכות תמונה', en: 'Picture quality' },
  loading: { he: 'טוענים את תל אביב...', en: 'Loading Tel Aviv...' },
  allFound: { he: 'מצאת את כל המקומות!', en: 'You found every place!' },
  pauseButton: { he: 'הפסקה', en: 'Pause' },
  altitude: { he: 'גובה', en: 'Altitude' },
  speed: { he: 'מהירות', en: 'Speed' },
  north: { he: 'צ', en: 'N' },
} satisfies Record<string, Bilingual>;

export const QUALITY_LABELS: Record<'auto' | 'low' | 'medium' | 'high', Bilingual> = {
  auto: { he: 'אוטומטי', en: 'Auto' },
  low: { he: 'נמוכה', en: 'Low' },
  medium: { he: 'בינונית', en: 'Medium' },
  high: { he: 'גבוהה', en: 'High' },
};

export const METERS: Bilingual = { he: 'מ׳', en: 'm' };
export const KILOMETERS: Bilingual = { he: 'ק״מ', en: 'km' };

export function formatDistance(meters: number, lang: keyof Bilingual): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} ${KILOMETERS[lang]}`;
  return `${Math.round(meters / 10) * 10} ${METERS[lang]}`;
}

export function celebrationText(target: 'school' | 'gan' | 'all', player: PlayerName): { title: Bilingual; sub: Bilingual | null } {
  const name = PLAYERS[player];
  if (target === 'all') {
    return {
      title: { he: `${name.he}, אתה תוכי-על!`, en: 'Super macaw!' },
      sub: { he: 'מצאת את שני המקומות', en: `${name.en}, you found both places!` },
    };
  }
  const place = TARGETS[target];
  return { title: { he: `${name.he} מצא את ${place.he}!`, en: `${name.en} found ${place.en}!` }, sub: null };
}

/** Hint keys the game may put in HudFrame.hint. Unknown keys render nothing. */
export const HINT_KEYS = ['takeoff', 'flap', 'landHere', 'walk', 'nearTarget', 'boost', 'squawk', 'rings', 'roll'] as const;
export type HintKey = (typeof HINT_KEYS)[number];

type Control = 'flap' | 'land' | 'boost' | 'squawk' | 'roll' | 'move';

const CONTROL_LABELS: Record<Device, Record<Control, Bilingual>> = {
  keyboard: {
    flap: { he: 'רווח', en: 'Space' }, land: { he: 'L', en: 'L' }, boost: { he: 'Shift', en: 'Shift' },
    squawk: { he: 'X', en: 'X' }, roll: { he: 'Q / E', en: 'Q / E' }, move: { he: '← ↑ → ↓', en: 'WASD' },
  },
  touch: {
    flap: { he: 'כנפיים', en: 'FLAP' }, land: { he: 'נחיתה', en: 'LAND' }, boost: { he: 'טורבו', en: 'BOOST' },
    squawk: { he: 'קריאה', en: 'SQUAWK' }, roll: { he: 'כנפיים', en: 'FLAP' }, move: { he: 'ג׳ויסטיק', en: 'joystick' },
  },
  gamepad: {
    flap: { he: 'A', en: 'A' }, land: { he: 'B', en: 'B' }, boost: { he: 'RT', en: 'RT' },
    squawk: { he: 'Y', en: 'Y' }, roll: { he: 'LB / RB', en: 'LB / RB' }, move: { he: 'מקל שמאלי', en: 'left stick' },
  },
};

const HINTS: Record<HintKey, Bilingual> = {
  takeoff: { he: 'החזק {flap} כדי להמריא!', en: 'Hold {flap} to take off!' },
  flap: { he: 'החזק {flap} כדי לעלות', en: 'Hold {flap} to climb' },
  landHere: { he: 'לחץ {land} כדי לנחות כאן!', en: 'Press {land} to land here!' },
  walk: { he: 'זוז עם {move}. לחץ {land} כדי להמריא', en: 'Move with {move}. Press {land} to fly' },
  nearTarget: { he: 'אתה קרוב! חפש מקום לנחות ולחץ {land}', en: 'So close! Find a spot and press {land}' },
  boost: { he: 'החזק {boost} לטורבו!', en: 'Hold {boost} for turbo!' },
  squawk: { he: 'לחץ {squawk} כדי לקרוא!', en: 'Press {squawk} to squawk!' },
  rings: { he: 'עוף דרך הטבעות הזהובות!', en: 'Fly through the golden rings!' },
  roll: { he: '{roll} לגלגול באוויר!', en: '{roll} for a barrel roll!' },
};

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Hint as HTML (controls wrapped in <kbd>) for each language, or null for an unknown key. */
export function hintHtml(key: string, device: Device): Bilingual | null {
  const template = HINTS[key as HintKey];
  if (!template) return null;
  const render = (lang: keyof Bilingual) => escapeHtml(template[lang]).replace(/\{(\w+)\}/g, (_, control: Control) => `<kbd>${escapeHtml(CONTROL_LABELS[device][control][lang])}</kbd>`);
  return { he: render('he'), en: render('en') };
}
