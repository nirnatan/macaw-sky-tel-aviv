import type { Species } from '../contracts';

interface Palette {
  fan: [string, string, string][]; // per feather: base, mid, tip
  chest: string;
  head: string;
  headLight: string;
  facePatch: string;
  faceLines: string;
  beakUpper: string;
  beakLower: string;
}

const PALETTES: Record<Species, Palette> = {
  blueGold: {
    fan: [['#1b4fb8', '#2f78e6', '#52b0ff'], ['#2a6fe0', '#3f95f2', '#7cc8ff'], ['#e8a50f', '#ffc928', '#ffe27a'], ['#2a6fe0', '#3f95f2', '#7cc8ff'], ['#1b4fb8', '#2f78e6', '#52b0ff']],
    chest: '#ffc42e', head: '#2b7de9', headLight: '#6bb8ff', facePatch: '#fffaf0', faceLines: '#2a2a35', beakUpper: '#2e2a33', beakLower: '#1c1920',
  },
  scarlet: {
    fan: [['#c9211c', '#e8332a', '#ff6a4d'], ['#e8332a', '#ffc928', '#2f78e6'], ['#d1241f', '#f04a2e', '#ff8a5e'], ['#e8332a', '#ffc928', '#2f78e6'], ['#c9211c', '#e8332a', '#ff6a4d']],
    chest: '#e8332a', head: '#e8332a', headLight: '#ff7a5a', facePatch: '#fff6e8', faceLines: '#a8201a', beakUpper: '#f3e4c4', beakLower: '#2a2528',
  },
};

const FAN_ANGLES = [-54, -27, 0, 27, 54];

const feather = (id: string, angle: number, colors: [string, string, string], index: number) => `
  <linearGradient id="${id}-f${index}" x1="0" y1="0" x2="0" y2="-92" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="${colors[0]}"/><stop offset=".5" stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[2]}"/>
  </linearGradient>
  <g transform="translate(70 126) rotate(${angle})">
    <path d="M0 0C-12-18-13-62 0-94 13-62 12-18 0 0Z" fill="url(#${id}-f${index})" stroke="rgba(0,0,0,.18)" stroke-width="1.5"/>
    <path d="M0-4V-84" stroke="rgba(255,255,255,.55)" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M0-30l-7-9M0-30l7-9M0-48l-6-8M0-48l6-8M0-64l-4-7M0-64l4-7" stroke="rgba(255,255,255,.28)" stroke-width="1.2" stroke-linecap="round"/>
  </g>`;

/** A fan of tail feathers behind a cartoon macaw head, in the species' colors. */
export function macawCardArt(species: Species): string {
  const p = PALETTES[species];
  const id = `art-${species}`;
  return `<svg viewBox="0 0 140 140" aria-hidden="true">
    <defs>
      <radialGradient id="${id}-head" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="${p.headLight}"/><stop offset=".55" stop-color="${p.head}"/><stop offset="1" stop-color="${p.head}"/></radialGradient>
    </defs>
    <g transform="translate(70 124) scale(.8) translate(-70 -126)">${p.fan.map((colors, i) => feather(id, FAN_ANGLES[i]!, colors, i)).join('')}</g>
    <ellipse cx="62" cy="108" rx="34" ry="26" fill="${p.chest}" stroke="rgba(0,0,0,.15)" stroke-width="1.5"/>
    <circle cx="60" cy="64" r="36" fill="url(#${id}-head)" stroke="rgba(0,0,0,.18)" stroke-width="1.5"/>
    <ellipse cx="76" cy="68" rx="21" ry="19" fill="${p.facePatch}"/>
    <path d="M64 70c6 2 12 2 18 0M66 77c5 2 10 2 15 0M70 83c4 1 7 1 11 0" stroke="${p.faceLines}" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".7"/>
    <path d="M82 40C108 32 130 48 126 76 124 88 112 92 108 82 112 70 104 62 84 62Z" fill="${p.beakUpper}" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/>
    <path d="M86 64c14 0 20 6 20 14-8 3-20-2-20-14Z" fill="${p.beakLower}"/>
    <circle cx="74" cy="56" r="9" fill="#fff"/>
    <circle cx="75" cy="56" r="6.500" fill="#f6c32b"/>
    <circle cx="76" cy="56" r="3.800" fill="#14121a"/>
    <circle cx="77.500" cy="54.200" r="1.500" fill="#fff"/>
  </svg>`;
}

export function avatarArt(player: 'Amit' | 'Or'): string {
  if (player === 'Or') {
    const rays = Array.from({ length: 12 }, (_, i) => `<path d="M32 4v8" stroke="#fff3b0" stroke-width="3.500" stroke-linecap="round" transform="rotate(${i * 30} 32 32)"/>`).join('');
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="31" fill="#ffb627"/>${rays}<circle cx="32" cy="32" r="13" fill="#fff6c9"/><circle cx="32" cy="32" r="9" fill="#ff8a1f"/></svg>`;
  }
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="31" fill="#2fb8d8"/><path d="M0 40c8-6 16-6 24 0s16 6 24 0 12-4 16-2v26H0z" fill="#1d8fb8"/><path d="M32 12l4.500 10 11 1.200-8.200 7.500 2.400 10.800L32 35.800 22.300 41.500l2.400-10.800-8.200-7.500 11-1.200z" fill="#fff3b0"/></svg>`;
}

export function targetIcon(id: 'school' | 'gan'): string {
  if (id === 'school') {
    return `<svg viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 3v8" stroke="#6b4a3a" stroke-width="1.800" stroke-linecap="round"/><path d="M20 3l8 2.500-8 2.500z" fill="#ff5a4a"/>
      <path d="M5 36V17l15-8.500L35 17v19z" fill="#ffd9a0" stroke="#8a5a3c" stroke-width="1.800" stroke-linejoin="round"/>
      <path d="M2.500 18.500 20 8.500l17.500 10" fill="none" stroke="#c9553c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="16" y="25" width="8" height="11" rx="1.500" fill="#7a4b32"/>
      <rect x="8" y="21" width="5" height="5" rx="1" fill="#7fc8e8"/><rect x="27" y="21" width="5" height="5" rx="1" fill="#7fc8e8"/>
      <circle cx="20" cy="17.500" r="2.800" fill="#fff" stroke="#8a5a3c" stroke-width="1.200"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="32" cy="9" r="5" fill="#ffd23a"/><path d="M32 1.500v2M32 14.500v2M24.500 9h2M37.500 9h2" stroke="#ffd23a" stroke-width="1.800" stroke-linecap="round"/>
    <path d="M6 36V19l14-10 14 10v17z" fill="#b8e8c4" stroke="#3d7a5a" stroke-width="1.800" stroke-linejoin="round"/>
    <path d="M3 20.500 20 8l17 12.500" fill="none" stroke="#2fa57e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M16 36v-8a4 4 0 0 1 8 0v8z" fill="#ff9a5a"/>
    <circle cx="11.500" cy="27" r="2.500" fill="#ff7a9a"/><circle cx="28.500" cy="27" r="2.500" fill="#ffd23a"/>
    <path d="M11.500 29.500V35M28.500 29.500V35" stroke="#3d7a5a" stroke-width="1.500"/>
  </svg>`;
}

export const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.500"/><rect x="14" y="5" width="4" height="14" rx="1.500"/></svg>';
export const ringIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="7" ry="9" fill="none" stroke="#ffc928" stroke-width="3.500"/><ellipse cx="12" cy="12" rx="7" ry="9" fill="none" stroke="#fff3b0" stroke-width="1.200" transform="translate(-.8 -.8)"/></svg>';
export const checkIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.500l4.500 4.500L19 7.500" fill="none" stroke="currentColor" stroke-width="3.500" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Compass arrow, pointing up before rotation. */
export const compassArrow = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <path d="M24 4 38 40 24 32 10 40z" fill="#ffc928" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
  <path d="M24 4v28" stroke="#c97a0a" stroke-width="1.500" opacity=".5"/>
</svg>`;

/** Side-view macaw silhouette for the loader; `.wing` and `.tail` are animated by CSS. */
export const flyingMacawSilhouette = `<svg viewBox="0 0 160 100" aria-hidden="true">
  <g fill="#3a2350">
    <g class="tail"><path d="M64 50 2 92c14 3 54-12 70-30z"/><path d="M60 56 14 74c10 4 38-2 52-12z"/></g>
    <ellipse cx="84" cy="56" rx="33" ry="15" transform="rotate(-14 84 56)"/>
    <circle cx="113" cy="43" r="13.500"/>
    <path d="M121 35c14-3 24 5 20 18-2 5-8 5-9 0 2-6-3-10-11-9z"/>
    <path class="wing" d="M100 49C94 26 80 8 54 0c0 9 2 17 6 24-8-6-16-6-24-4 6 8 14 14 22 18-10-2-18 0-26 4 14 10 42 14 68 7z"/>
  </g>
  <circle cx="115" cy="40" r="2.600" fill="#ffd9a0"/>
</svg>`;
