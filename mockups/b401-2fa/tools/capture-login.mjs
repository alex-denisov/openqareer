// B401: шаг «код из приложения» внутри настоящего экрана входа. Снимает /login из собранного dist
// (vite preview), заменяет форму на поле кода и сохраняет самодостаточный HTML со стилями сайта.
// Запуск: npx vite preview --port <порт>, затем node tools/capture-login.mjs <порт>.
import { chromium } from '@playwright/test';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.resolve(ROOT, '../../dist/assets');
const port = process.argv[2] ?? '4393';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route('**/api/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
await page.goto(`http://127.0.0.1:${port}/login`);
await page.waitForSelector('.auth-form');
const { html, css } = await page.evaluate(() => {
  document.querySelector('.auth-notice')?.remove();
  document.querySelector('.auth-card-header p')?.remove();
  const form = document.querySelector('.auth-form');
  form.innerHTML = `<div class="auth-field"><div class="auth-field-header"><label for="login-code">Код из приложения или резервный код</label></div><div class="auth-field-input"><input id="login-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="11" required value=""></div></div><button type="submit" class="site-btn is-primary auth-submit-btn">Войти в кабинет</button>`;
  document.querySelector('.auth-links').innerHTML = '<button type="button">← Войти с другим аккаунтом</button>';
  const css = [...document.styleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)).join('\n');
  document.querySelectorAll('script, link[rel="stylesheet"], link[rel="modulepreload"], style').forEach((n) => n.remove());
  return { html: document.documentElement.outerHTML, css };
});
await browser.close();
const fonts = new Set();
const localCss = css.replace(/url\("?\/assets\/([^")]+)"?\)/g, (_m, file) => {
  fonts.add(file);
  return `url("../site-assets/${file}")`;
});
mkdirSync(path.join(ROOT, 'site-assets'), { recursive: true });
for (const file of fonts) copyFileSync(path.join(DIST, file), path.join(ROOT, 'site-assets', file));
const out = html
  .replace(/<title>[^<]*<\/title>/, '<title>Вход · код из приложения</title>')
  .replace('</head>', `<style>\n${localCss}\n</style>\n</head>`);
writeFileSync(path.join(ROOT, 'screens', 'login-kod-iz-prilozheniya.html'), `<!doctype html>\n${out}`);
console.log('fonts', fonts.size);
