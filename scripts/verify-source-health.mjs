/**
 * B200 — доказательство, что суперадминка показывает живость и доверие площадок
 * на живой подписанной сессии, а не только в юнит-тестах.
 *
 * Пароль администратора читается из локального `openqareer.env` и уходит прямо
 * в браузерный контекст: через агента он не проходит.
 *
 * Запуск: node scripts/verify-source-health.mjs [базовый-адрес]
 */
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = 'output/b200';
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

function credentials() {
  const fromEnv = {
    username: process.env.OPENQAREER_ADMIN_USERNAME,
    password: process.env.OPENQAREER_ADMIN_PASSWORD,
  };
  if (fromEnv.username && fromEnv.password) return fromEnv;

  const file = join(homedir(), '.openqareer', 'openqareer.env');
  const parsed = new Map(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trimStart().startsWith('#'))
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^"|"$/g, '')];
      }),
  );
  const username = parsed.get('OPENQAREER_ADMIN_USERNAME');
  const password = parsed.get('OPENQAREER_ADMIN_PASSWORD');
  if (!username || !password) {
    throw new Error(`Нет учётных данных администратора: ни в окружении, ни в ${file}`);
  }
  return { username, password };
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const failures = [];

  try {
    await measureEveryViewport(browser, failures);
  } finally {
    // Браузер закрывается и при отказе: иначе упавший прогон оставлял бы
    // висящий процесс, и запуск выглядел бы зависшим, а не провалившимся.
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\nПРОВАЛ: ${failures.length}`);
    process.exitCode = 1;
  } else {
    console.log('\nОК: обе ширины без ошибок и без горизонтального вылета.');
  }
}

async function measureEveryViewport(browser, failures) {
  // Вход делается один раз на прогон: защита от перебора паролей (B196)
  // отвечает `429` на второй вход подряд, и это правильно — обходить её
  // проверкой нельзя, поэтому сессия переиспользуется.
  const signIn = await browser.newContext();
  const login = await signIn.request.post(`${BASE}/api/v1/auth/login`, {
    data: credentials(),
    headers: { origin: BASE },
  });
  if (!login.ok()) {
    throw new Error(`Вход не удался: ${login.status()} ${await login.text()}`);
  }
  const storageState = await signIn.storageState();
  await signIn.close();

  for (const viewport of VIEWPORTS) {
    await measureOne(browser, storageState, viewport, failures);
  }
}

/** Что экран напечатал: приговоры по карточкам и горизонтальный вылет. */
async function readSourceCards(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.admin-source-card'));
    return {
      cards: cards.length,
      verdicts: cards
        .map((card) => {
          const badges = card.querySelectorAll('.admin-source-health-badges .admin-badge');
          const name = card.querySelector('h3')?.textContent ?? '';
          return badges.length === 2
            ? `${name}: ${badges[0].textContent} · ${badges[1].textContent}`
            : `${name}: ${card.querySelector('.admin-source-health .admin-badge')?.textContent ?? '—'}`;
        })
        .slice(0, 30),
      // Горизонтальной прокрутки быть не должно ни на одной ширине.
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

/**
 * B207 — отказ маршрута обязан быть назван. Раньше провал выглядел ровно как
 * честный ответ «источников нет»: пустая сетка и ничего больше. Проверяется
 * сам переход, а не наличие страницы: маршрут заставляют отказать и смотрят,
 * что экран печатает.
 */
async function measureRefusal(page) {
  const pattern = '**/api/v1/admin/vacancy-sources?*';
  const handler = (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'unavailable', message: 'Маршрут отказал: проверка B207.' },
      }),
    });

  await page.route(pattern, handler);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.admin-error[role="alert"]', { timeout: 20_000 });
    const seen = await page.evaluate(() => {
      const alert = document.querySelector('.admin-error[role="alert"]');
      return {
        message: alert?.querySelector('p')?.textContent ?? '',
        retry: Array.from(alert?.querySelectorAll('button') ?? []).some(
          (button) => button.textContent?.trim() === 'Повторить',
        ),
        cards: document.querySelectorAll('.admin-source-card').length,
      };
    });
    if (!seen.retry) return { ok: false, verdict: 'отказ назван, но кнопки повтора нет' };
    if (seen.cards > 0) return { ok: false, verdict: 'при отказе экран всё ещё рисует карточки' };
    return { ok: true, verdict: `назван словами сервера — «${seen.message}»` };
  } catch (error) {
    return { ok: false, verdict: `отказ не назван: ${String(error).slice(0, 80)}` };
  } finally {
    await page.unroute(pattern, handler);
  }
}

async function measureOne(browser, storageState, viewport, failures) {
  {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      storageState,
    });
    const page = await context.newPage();
    const problems = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    const aborted = [];
    page.on('requestfailed', (request) => {
      const reason = request.failure()?.errorText ?? 'unknown';
      // Отменённый запрос отказом сети не является. В dev React StrictMode
      // монтирует экран дважды, и уборка первого монтирования сама обрывает
      // свой же запрос через AbortController (`useVacancySourcesPage`). В
      // продовой сборке этого двойного монтирования нет.
      if (reason === 'net::ERR_ABORTED') {
        aborted.push(request.url());
        return;
      }
      problems.push(`request: ${request.url()} ${reason}`);
    });

    await page.goto(`${BASE}/admin?tab=sources`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.admin-source-health', { timeout: 30_000 });

    const measured = await readSourceCards(page);

    await page.screenshot({
      path: join(OUT, `sources-${viewport.name}.png`),
      fullPage: true,
    });

    console.log(`\n=== ${viewport.name} ${viewport.width}×${viewport.height} ===`);
    console.log(`карточек: ${measured.cards}, горизонтальный вылет: ${measured.overflow}px`);
    if (aborted.length > 0) {
      console.log(`отменённых страницей запросов (не отказ): ${aborted.length}`);
    }
    for (const verdict of measured.verdicts) console.log(`  ${verdict}`);
    if (problems.length > 0) {
      console.log('ПРОБЛЕМЫ:');
      for (const problem of problems) console.log(`  ${problem}`);
      failures.push(...problems.map((problem) => `${viewport.name}: ${problem}`));
    }
    if (measured.overflow > 0) failures.push(`${viewport.name}: горизонтальный вылет`);
    if (measured.cards === 0) failures.push(`${viewport.name}: ни одной карточки источника`);

    const refusal = await measureRefusal(page);
    console.log(`отказ маршрута: ${refusal.verdict}`);
    if (!refusal.ok) failures.push(`${viewport.name}: ${refusal.verdict}`);

    await context.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
