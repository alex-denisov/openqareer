/**
 * INC-024 — доказательство, что кабинет живёт из серверного состояния, а не из
 * `localStorage`: после чистого входа (браузер без единого ключа — ровно то,
 * что видит кандидат после выхода) разделы открыты, а число фактов на экране
 * совпадает с числом, которое отдал сервер.
 *
 * Пароль читается скриптом из `~/.openqareer/openqareer.env` и уходит прямо в
 * поле формы: через контекст агента он не проходит.
 *
 * Запуск: node scripts/verify-cabinet-hydration.mjs [базовый-адрес]
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'https://openqareer.com').replace(/\/$/, '');
const ENV_FILE = process.env.OPENQAREER_ENV_FILE ?? join(homedir(), '.openqareer/openqareer.env');
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

function credentials() {
  const values = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  const username = values.OPENQAREER_TEST_CANDIDATE_USERNAME;
  const password = values.OPENQAREER_TEST_CANDIDATE_PASSWORD;
  if (!username || !password) throw new Error(`в ${ENV_FILE} нет тестового кандидата`);
  return { username, password };
}

async function signIn(page, { username, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-identifier', username);
  await page.fill('#login-password', password);
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    page.click('button.auth-submit-btn'),
  ]);
  await page.waitForTimeout(3000);
  return !new URL(page.url()).pathname.startsWith('/login');
}

/**
 * Что кабинет утверждает на экране и что в тот же момент отвечает сервер.
 * Расхождение этих двух чисел и было симптомом INC-024.
 */
async function readState(page) {
  return page.evaluate(async () => {
    const ask = async (path) => {
      const response = await fetch(path, { credentials: 'include' });
      return { status: response.status, body: response.ok ? await response.json() : null };
    };
    const me = await ask('/api/v1/candidate/me');
    const workspace = await ask('/api/v1/candidate/workspace');

    const navigation = [...document.querySelectorAll('nav[aria-label="Основная навигация"] button')]
      .map((button) => ({
        label: (button.textContent ?? '').trim().split('\n')[0],
        locked: button.disabled,
      }))
      .filter((item) => item.label.length > 0);

    const text = document.body.innerText;
    const onScreenFacts = /(\d+)\s+подтверждённ/iu.exec(text)?.[1] ?? null;

    return {
      meStatus: me.status,
      confirmedCount: me.body?.data?.dossier?.confirmedCount ?? me.body?.dossier?.confirmedCount ?? null,
      workspaceStatus: workspace.status,
      workspaceKeys: workspace.body
        ? Object.keys(workspace.body.data ?? workspace.body).sort()
        : [],
      navigation,
      onScreenFacts: onScreenFacts === null ? null : Number(onScreenFacts),
      saysEmptyCabinet: /Начните с карьерного вопроса|Завершите карьерную диагностику/u.test(text),
      storageKeys: Object.keys(window.localStorage),
    };
  });
}

async function signOutInPage(page) {
  await page.click('[aria-label="Открыть аккаунт"]');
  await page.waitForSelector('.career-account-signout', { timeout: 15000 });
  await page.click('.career-account-signout');
  await page.waitForTimeout(2500);
}

/** Расхождения первого — чистого — входа. */
function judgeFirstEntry(name, state) {
  const failures = [];
  const locked = state.navigation.filter((item) => item.locked);
  if (locked.length > 0) {
    failures.push(
      `${name}: после чистого входа заблокированы разделы — ${locked.map((i) => i.label).join(', ')}`,
    );
  }
  if (state.saysEmptyCabinet) failures.push(`${name}: кабинет встречает как нового пользователя`);
  if (state.workspaceStatus !== 200) {
    failures.push(`${name}: ответы мастера не восстановились (${state.workspaceStatus})`);
  }
  if (
    state.onScreenFacts !== null &&
    state.confirmedCount !== null &&
    state.onScreenFacts !== state.confirmedCount
  ) {
    failures.push(`${name}: экран говорит ${state.onScreenFacts}, сервер — ${state.confirmedCount}`);
  }
  return failures;
}

/** Расхождения второго круга: выход в интерфейсе и вход снова. */
function judgeSecondEntry(name, state) {
  const failures = [];
  const locked = state.navigation.filter((item) => item.locked);
  if (locked.length > 0) {
    failures.push(
      `${name}: после выхода и входа разделы заблокированы заново — ${locked
        .map((i) => i.label)
        .join(', ')}`,
    );
  }
  if (state.saysEmptyCabinet) failures.push(`${name}: после выхода и входа кабинет встречает как нового`);
  return failures;
}

function describe(name, round, state) {
  process.stdout.write(
    `\n${name} · ${round}\n` +
      `  /candidate/me: ${state.meStatus}, подтверждённых фактов на сервере: ${state.confirmedCount}\n` +
      `  /candidate/workspace: ${state.workspaceStatus}, поля: ${state.workspaceKeys.join(', ') || '—'}\n` +
      `  на экране подтверждённых фактов: ${state.onScreenFacts ?? '—'}\n` +
      `  разделы: ${state.navigation.map((i) => `${i.label}${i.locked ? ' (заблокирован)' : ''}`).join(' · ')}\n` +
      `  ключи localStorage: ${state.storageKeys.join(', ') || 'нет'}\n`,
  );
}

/** Один проход по одной ширине; возвращает список найденных расхождений. */
async function walkOneViewport(browser, viewport, account) {
  const failures = [];
  {
    // Новый контекст — пустой `localStorage`: ровно то состояние браузера, в
    // котором кандидат оказывается после выхода из аккаунта.
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    const problems = [];
    page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
    page.on('pageerror', (e) => problems.push(`page: ${e.message}`));
    page.on('requestfailed', (r) =>
      problems.push(`request: ${r.method()} ${r.url()} — ${r.failure()?.errorText}`),
    );

    if (!(await signIn(page, account))) {
      failures.push(`${viewport.name}: вход не выполнен`);
      await context.close();
      return failures;
    }

    const first = await readState(page);
    describe(viewport.name, 'чистый вход', first);
    failures.push(...judgeFirstEntry(viewport.name, first));

    // Второй круг: выход прямо в интерфейсе и вход снова — тот самый путь из
    // отчёта INC-024, а не только чистый браузер.
    await signOutInPage(page);
    const afterSignOut = new URL(page.url()).pathname;
    if (!(await signIn(page, account))) {
      failures.push(`${viewport.name}: повторный вход не выполнен`);
      await context.close();
      return failures;
    }
    const second = await readState(page);
    describe(viewport.name, `выход (${afterSignOut}) → вход`, second);
    failures.push(...judgeSecondEntry(viewport.name, second));

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    if (overflow) failures.push(`${viewport.name}: горизонтальный вылет`);
    if (problems.length > 0) failures.push(`${viewport.name}: ${problems.join('; ')}`);

    await context.close();
  }
  return failures;
}

async function run() {
  const account = credentials();
  const browser = await chromium.launch();
  const failures = [];
  for (const viewport of VIEWPORTS) {
    failures.push(...(await walkOneViewport(browser, viewport, account)));
  }

  await browser.close();

  if (failures.length > 0) {
    process.stdout.write(`\nПРОВАЛ:\n- ${failures.join('\n- ')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('\nОК: кабинет переживает выход, числа экрана и сервера совпадают.\n');
}

await run();
