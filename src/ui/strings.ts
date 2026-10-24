import type { InputState, PlayerName, Species, TargetId, TimeOfDay } from '../contracts';
import { placeById } from '../places';

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
/** For the compact cards on phones, where the "Pick your macaw" heading already says macaw. */
export const SPECIES_SHORT: Record<Species, Bilingual> = {
  blueGold: { he: 'כחול-צהוב', en: 'Blue & Gold' },
  scarlet: { he: 'אדום', en: 'Scarlet' },
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
  timeOfDay: { he: 'זמן ביום', en: 'Time of day' },
  rain: { he: 'גשם', en: 'Rain' },
  loading: { he: 'טוענים את תל אביב...', en: 'Loading Tel Aviv...' },
  allFound: { he: 'מצאת את כל המקומות!', en: 'You found every place!' },
  pauseButton: { he: 'הפסקה', en: 'Pause' },
  altitude: { he: 'גובה', en: 'Altitude' },
  speed: { he: 'מהירות', en: 'Speed' },
  north: { he: 'צ', en: 'N' },
  tilt: { he: 'הטה לנווט', en: 'Tilt to steer' },
  tiltOn: { he: 'הטה את הטלפון כדי לנווט!', en: 'Tilt the phone to steer!' },
  tiltDenied: { he: 'לא קיבלנו אישור לתנועה. עפים עם הג׳ויסטיק!', en: 'No motion access. The joystick works great!' },
  tiltCentered: { he: 'מכוון! ככה עפים ישר', en: 'Centered! Hold it like this to fly straight' },
  tiltCenter: { he: 'מרכז', en: 'Center' },
  rotate: { he: 'סובב את הטלפון לרוחב', en: 'Turn your phone sideways' },
  rotateWhy: { he: 'ככה רואים הכי טוב!', en: 'for the best view' },
  installTitle: { he: 'משחק במסך מלא', en: 'Play full screen' },
  installShare: { he: 'לחצו על שיתוף', en: 'Tap Share' },
  installAdd: { he: 'ואז ״הוספה למסך הבית״', en: 'then “Add to Home Screen”' },
  gotIt: { he: 'הבנתי', en: 'Got it' },
} satisfies Record<string, Bilingual>;

export const MAP_CREDIT = 'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

export const QUALITY_LABELS: Record<'auto' | 'low' | 'medium' | 'high', Bilingual> = {
  auto: { he: 'אוטומטי', en: 'Auto' },
  low: { he: 'נמוכה', en: 'Low' },
  medium: { he: 'בינונית', en: 'Medium' },
  high: { he: 'גבוהה', en: 'High' },
};

export const TIME_LABELS: Record<TimeOfDay, Bilingual> = {
  sunrise: { he: 'זריחה', en: 'Sunrise' },
  noon: { he: 'צהריים', en: 'Noon' },
  sunset: { he: 'שקיעה', en: 'Sunset' },
  night: { he: 'לילה', en: 'Night' },
};

export const TIME_TOASTS: Record<TimeOfDay, Bilingual> = {
  sunrise: { he: 'בוקר טוב! זריחה', en: 'Good morning! Sunrise' },
  noon: { he: 'צהריים בשמש!', en: 'Sunny noon!' },
  sunset: { he: 'שקיעה זהובה', en: 'Golden sunset' },
  night: { he: 'לילה! תראו את הכוכבים', en: 'Night time! Look at the stars' },
};

export const RAIN_TOASTS = {
  on: { he: 'יורד גשם!', en: "It's raining!" },
  off: { he: 'הגשם נגמר', en: 'The rain stopped' },
  offRainbow: { he: 'הגשם נגמר. חפש קשת בענן!', en: 'Rain stopped. Find a rainbow!' },
} satisfies Record<string, Bilingual>;

/** Toasts render as one RTL line, so the English half is isolated to keep its own punctuation on the right side. */
export const toastText = (text: Bilingual) => `${text.he} · \u2066${text.en}\u2069`;

export const METERS: Bilingual = { he: 'מ׳', en: 'm' };
export const KILOMETERS: Bilingual = { he: 'ק״מ', en: 'km' };

export function formatDistance(meters: number, lang: keyof Bilingual): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}\u00a0${KILOMETERS[lang]}`; // a wrapped compass line keeps the number with its unit
  return `${Math.round(meters / 10) * 10}\u00a0${METERS[lang]}`;
}

const WELCOME_HOME: Bilingual = { he: 'ברוך הבא הביתה!', en: 'Welcome home!' };

export function celebrationText(target: TargetId | 'all', player: PlayerName): { title: Bilingual; sub: Bilingual | null } {
  const name = PLAYERS[player];
  if (target === 'all') {
    return {
      title: { he: `${name.he}, אתה תוכי-על!`, en: 'Super macaw!' },
      sub: { he: UI_TEXT.allFound.he, en: `${name.en}, you found every place!` },
    };
  }
  const place = placeById(target);
  return {
    title: { he: `${name.he} מצא את ${place.nameHe}!`, en: `${name.en} found ${place.nameEn}!` },
    sub: place.style === 'home' ? WELCOME_HOME : null,
  };
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
