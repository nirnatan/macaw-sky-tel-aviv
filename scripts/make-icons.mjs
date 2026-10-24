// Renders the home-screen icons from one SVG in real Chrome: node scripts/make-icons.mjs
// The macaw is the start screen's own card art, so the icon and the game look like one thing.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { macawCardArt } from '../src/ui/art.ts';

const OUT = new URL('../public/icons/', import.meta.url);

const RAYS = Array.from({ length: 16 }, (_, i) => `<path d="M256 236 L${256 + 400 * Math.cos((i + 0.25) * Math.PI / 8)} ${236 + 400 * Math.sin((i + 0.25) * Math.PI / 8)} L${256 + 400 * Math.cos((i + 0.75) * Math.PI / 8)} ${236 + 400 * Math.sin((i + 0.75) * Math.PI / 8)}Z"/>`).join('');

const sunset = `
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff6f61"/><stop offset=".45" stop-color="#ffa94d"/><stop offset=".8" stop-color="#ffd76a"/><stop offset=".8" stop-color="#f3905f"/><stop offset="1" stop-color="#a0528f"/>
    </linearGradient>
    <radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fffbe6"/><stop offset=".65" stop-color="#ffec8a"/><stop offset="1" stop-color="#ffd23f"/></radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#sky)"/>
  <g fill="#fff3b0" opacity=".22">${RAYS}</g>
  <circle cx="256" cy="236" r="168" fill="url(#sun)"/>
  <g stroke="#ffe9a0" stroke-linecap="round" opacity=".85">
    <path d="M150 432h212" stroke-width="10"/><path d="M190 462h132" stroke-width="8"/><path d="M226 488h60" stroke-width="6"/>
  </g>`;

/** `scale` shrinks the bird toward the center; maskable icons keep everything inside the middle 80% circle. */
const iconSvg = ({ scale, rounded }) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
    ${rounded ? '<clipPath id="r"><rect width="512" height="512" rx="112"/></clipPath><g clip-path="url(#r)">' : '<g>'}
      ${sunset}
      <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
        <svg x="50" y="44" width="412" height="412" viewBox="0 0 140 140">${macawCardArt('blueGold').replace(/^\s*<svg[^>]*>|<\/svg>\s*$/g, '')}</svg>
      </g>
    </g>
  </svg>`;

const ICONS = [
  { file: 'apple-touch-icon.png', size: 180, scale: 1, rounded: false }, // iOS rounds the corners itself and wants no transparency
  { file: 'icon-192.png', size: 192, scale: 1, rounded: true },
  { file: 'icon-512.png', size: 512, scale: 1, rounded: true },
  { file: 'icon-maskable-192.png', size: 192, scale: 0.78, rounded: false },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.78, rounded: false },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const icon of ICONS) {
  const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${iconSvg(icon)}</body></html>`);
  await page.screenshot({ path: new URL(icon.file, OUT).pathname, omitBackground: true });
  await page.close();
  console.log('wrote', icon.file);
}
await browser.close();
