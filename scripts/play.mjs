// Scripted play-through in real Chrome: node scripts/play.mjs <url> <outDir> <steps.json>
// steps: [{ "keys": ["Space"], "ms": 1500 }, { "eval": "..." }, { "shot": "name" }, { "click": "selector" }]
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';

const [url, outDir, stepsFile] = process.argv.slice(2);
const steps = JSON.parse(await readFile(stepsFile, 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const [vw, vh] = (process.env.VIEWPORT ?? '1280x720').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: vw, height: vh }, hasTouch: !!process.env.TOUCH, isMobile: !!process.env.TOUCH });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
for (const s of steps) {
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.click) await page.click(s.click, { force: true });
  if (s.press) await page.keyboard.press(s.press);
  if (s.keys) {
    for (const k of s.keys) await page.keyboard.down(k);
    await page.waitForTimeout(s.ms ?? 1000);
    for (const k of s.keys) await page.keyboard.up(k);
  }
  if (s.eval) console.log('eval', JSON.stringify(await page.evaluate(s.eval)));
  if (s.shot) { await page.screenshot({ path: `${outDir}/${s.shot}.png` }); console.log('shot', s.shot); }
}
await browser.close();
