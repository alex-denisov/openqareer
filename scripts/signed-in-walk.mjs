#!/usr/bin/env node
/**
 * Вход в продукт под тестовой учётной записью и обход подписанных экранов.
 *
 * ПОЧЕМУ СКРИПТ, А НЕ РУЧНОЙ ВВОД В БРАУЗЕРЕ. Пароль читается из
 * `~/.openqareer/openqareer.env` самим скриптом и уходит прямо в поле формы:
 * через контекст агента он не проходит и в переписке не появляется. Это же
 * делает проверку воспроизводимой — следующая сессия повторяет её одной
 * командой, а не пересобирает координаты полей.
 *
 * Запуск:
 *   node scripts/signed-in-walk.mjs                        # прод, кандидат
 *   node scripts/signed-in-walk.mjs --base http://localhost:3000
 *   node scripts/signed-in-walk.mjs --role admin
 *   node scripts/signed-in-walk.mjs --path /cabinet --shot out.png
 *   node scripts/signed-in-walk.mjs --eval "document.title"
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { chromium } from 'playwright';

const ENV_FILE = process.env.OPENQAREER_ENV_FILE ?? join(homedir(), '.openqareer/openqareer.env');

/** Последнее присваивание выигрывает — в файле встречаются повторы ключей. */
function readEnvironment(file) {
  if (!existsSync(file)) {
    throw new Error(`нет файла с учётными данными: ${file}`);
  }
  const values = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const base = argument('base', 'https://openqareer.com').replace(/\/$/, '');
const role = argument('role', 'candidate');
const path = argument('path', '/');
const shot = argument('shot', null);
const script = argument('eval', null);
const width = Number(argument('width', '1440'));
const height = Number(argument('height', '900'));

const environment = readEnvironment(ENV_FILE);
const credentials =
  role === 'admin'
    ? {
        username: environment.OPENQAREER_ADMIN_USERNAME,
        password: environment.OPENQAREER_ADMIN_PASSWORD,
      }
    : {
        username: environment.OPENQAREER_TEST_CANDIDATE_USERNAME,
        password: environment.OPENQAREER_TEST_CANDIDATE_PASSWORD,
      };

if (!credentials.username || !credentials.password) {
  throw new Error(`в ${ENV_FILE} нет учётной записи для роли «${role}»`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width, height } });
const page = await context.newPage();

const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => problems.push(`page: ${error.message}`));
page.on('requestfailed', (request) => {
  problems.push(`request: ${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
});

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#login-identifier', credentials.username);
await page.fill('#login-password', credentials.password);
await Promise.all([
  page.waitForLoadState('networkidle').catch(() => {}),
  page.click('button.auth-submit-btn'),
]);
await page.waitForTimeout(2500);

const signedIn = !new URL(page.url()).pathname.startsWith('/login');
process.stdout.write(`вход под «${credentials.username}»: ${signedIn ? 'да' : 'НЕТ'} → ${page.url()}\n`);
if (!signedIn) {
  const message = await page.locator('[role="alert"]').first().textContent().catch(() => null);
  if (message) process.stdout.write(`сообщение формы: ${message.trim()}\n`);
}

if (path !== '/') {
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
}

if (script) {
  const value = await page.evaluate(script);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (shot) {
  mkdirSync(dirname(shot), { recursive: true });
  await page.screenshot({ path: shot, fullPage: false });
  process.stdout.write(`снимок: ${shot}\n`);
}

process.stdout.write(
  problems.length === 0
    ? 'ошибок консоли, страницы и запросов нет\n'
    : `ошибки (${problems.length}):\n${problems.map((p) => `  ${p}`).join('\n')}\n`,
);

await browser.close();
process.exit(signedIn ? 0 : 1);
