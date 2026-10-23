// Screenshots a page in real Chrome: node scripts/shot.mjs <url> <out.png> [waitMs] [jsToRunBeforeShot]
// Prints console errors so WebGL/shader failures are visible.
import { chromium } from 'playwright-core';

const [url, out = 'shot.png', wait = '4000', js] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Number(wait));
if (js) console.log('eval ->', JSON.stringify(await page.evaluate(js)));
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
