// B401: снимки 1440×900 и 390×844, светлая и тёмная тема (как d01-workplace/shoot.mjs).
import { chromium } from '@playwright/test';
import path from 'node:path';
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const files = ['n04f-2fa-vyklyuchena', 'n04d-vklyuchit-2fa', 'n04e-rezervnye-kody', 'login-kod-iz-prilozheniya'];
const browser = await chromium.launch();
for (const f of files) for (const dark of [false, true]) for (const { w, h } of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: dark ? 'dark' : 'light' });
  await p.goto('file://' + path.join(ROOT, 'screens', f + '.html'), { waitUntil: 'load' });
  if (dark) await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await p.addStyleTag({ content: '*{transition:none!important}' });
  await p.mouse.move(w - 2, 2); await p.waitForTimeout(150);
  await p.screenshot({ path: path.join(ROOT, dark ? 'pngs-dark' : 'pngs', `${f}-${w}.png`), fullPage: w > 767 });
  await p.close();
}
await browser.close();
