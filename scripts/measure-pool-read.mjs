#!/usr/bin/env node
/**
 * Сколько запросов и сколько времени уходит у кабинета на чтение подбора (B211).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ СКРИПТ. `signed-in-walk.mjs` выполняет свой код после того,
 * как страница успокоилась, а измерять надо ровно то, что происходит **до**
 * этого: чтение пула начинается на входе в кабинет и идёт, пока обход ждёт.
 * Здесь запросы считаются событиями браузера с самого входа, поэтому счёт не
 * зависит от того, успел ли обход навесить свой перехват.
 *
 * Пароль читается скриптом из `~/.openqareer/openqareer.env` и в вывод не
 * попадает — тот же приём, что в `signed-in-walk.mjs`.
 *
 * Запуск: node scripts/measure-pool-read.mjs [--base https://openqareer.com]
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const ENV_FILE = process.env.OPENQAREER_ENV_FILE ?? join(homedir(), '.openqareer/openqareer.env');

function readEnvironment(file) {
  if (!existsSync(file)) throw new Error(`нет файла с учётными данными: ${file}`);
  const values = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const base = argument('base', 'https://openqareer.com').replace(/\/$/, '');
const quietMs = Number(argument('quiet', '10000'));
const limitMs = Number(argument('limit', '180000'));
const environment = readEnvironment(ENV_FILE);
const username = environment.OPENQAREER_TEST_CANDIDATE_USERNAME;
const password = environment.OPENQAREER_TEST_CANDIDATE_PASSWORD;
if (!username || !password) throw new Error(`в ${ENV_FILE} нет учётной записи кандидата`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const calls = new Map();
const failures = [];
const isPool = (url) => url.includes('/candidate/matched-vacancies');

page.on('request', (request) => {
  if (isPool(request.url())) calls.set(request, { started: Date.now(), ended: null });
});
page.on('response', (response) => {
  const call = calls.get(response.request());
  if (call) {
    call.ended = Date.now();
    call.status = response.status();
  }
});
page.on('requestfailed', (request) => {
  const call = calls.get(request);
  if (call) {
    call.ended = Date.now();
    call.failed = request.failure()?.errorText ?? 'неизвестно';
    failures.push(`${request.url()} — ${call.failed}`);
  }
});

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#login-identifier', username);
await page.fill('#login-password', password);
await page.click('button.auth-submit-btn');
await page.waitForTimeout(4_000);
const signedIn = !new URL(page.url()).pathname.startsWith('/login');
process.stdout.write(`вход под «${username}»: ${signedIn ? 'да' : 'НЕТ'} → ${page.url()}\n`);
if (!signedIn) {
  // Защита частоты входа (B196) отвечает словами — их и надо показать, иначе
  // неудачный вход выглядит как пустой замер.
  const said = await page.locator('[role="alert"]').first().textContent().catch(() => null);
  if (said) process.stdout.write(`сообщение формы: ${said.trim()}\n`);
  await browser.close();
  process.exit(1);
}

const startedAt = Date.now();
for (;;) {
  const entries = [...calls.values()];
  const open = entries.filter((call) => call.ended === null).length;
  const lastEnd = Math.max(0, ...entries.map((call) => call.ended ?? 0));
  const quiet = entries.length > 0 && open === 0 && Date.now() - lastEnd > quietMs;
  if (quiet || Date.now() - startedAt > limitMs) break;
  await page.waitForTimeout(250);
}

const entries = [...calls.values()].filter((call) => call.ended !== null);
let peak = 0;
for (const call of entries) {
  peak = Math.max(
    peak,
    entries.filter((other) => other.started < call.ended && other.ended > call.started).length,
  );
}
const first = Math.min(...entries.map((call) => call.started));
const last = Math.max(...entries.map((call) => call.ended));
const seconds = (value) => Math.round(value / 100) / 10;

process.stdout.write(
  [
    `запросов подбора: ${entries.length}`,
    `максимум одновременно: ${peak}`,
    `от первого до последнего: ${seconds(last - first)} с`,
    `средний круг: ${seconds(entries.reduce((sum, c) => sum + (c.ended - c.started), 0) / entries.length)} с`,
    `неуспешных: ${entries.filter((c) => c.failed || (c.status && c.status >= 400)).length}`,
  ].join('\n') + '\n',
);
if (failures.length > 0) process.stdout.write(`отказы:\n  ${failures.join('\n  ')}\n`);

await browser.close();
