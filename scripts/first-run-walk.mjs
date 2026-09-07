/**
 * INC-024 — первый симптом: «после импорта резюме кабинет показывает „Фактов
 * пока нет“, хотя сервер вернул `factCount`». Проверить его можно только новым
 * аккаунтом: у существующего мастер уже пройден.
 *
 * Скрипт заводит синтетическую учётную запись (разрешение владельца от
 * 2026-09-07), проходит мастер, вставляет выдуманное резюме и сравнивает то,
 * что кабинет утверждает на экране, с тем, что в тот же момент отвечает сервер.
 *
 * Пароль генерируется здесь же и дописывается в `~/.openqareer/openqareer.env`
 * под ключами `OPENQAREER_QA_CANDIDATE_*`. В вывод он не попадает и через
 * контекст агента не проходит.
 *
 * Учётная запись остаётся в проде намеренно — повторный прогон ей не нужен,
 * а удаление синтетического кандидата делается кнопкой «Удалить навсегда» в
 * панели аккаунта. Имя записано в тикете.
 *
 * Запуск: node scripts/first-run-walk.mjs [базовый-адрес]
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const positional = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const BASE = (positional ?? 'https://openqareer.com').replace(/\/$/, '');
const ENV_FILE = process.env.OPENQAREER_ENV_FILE ?? join(homedir(), '.openqareer/openqareer.env');

/** Выдуманное резюме: ни одного настоящего человека здесь нет (INC-023). */
const RESUME = [
  'Иван Синтетов — Senior Software Engineer',
  'Москва · готов к релокации · английский C1',
  '',
  'ООО «Финтех Платформа», Москва — Senior Software Engineer',
  'Март 2021 — настоящее время',
  'Веду платформенную команду из шести инженеров.',
  'Снизил время отклика профиля с 2.4 с до 0.9 с, переписав слой выборки.',
  'Собрал сквозные метрики доставки и сократил цикл релиза с двух недель до двух дней.',
  'Стек: TypeScript, React, Node.js, PostgreSQL, Kubernetes.',
  '',
  'ООО «Логистика Плюс», Москва — Backend Developer',
  'Июнь 2017 — февраль 2021',
  'Маршрутизация заказов и интеграции с ERP заказчиков.',
  'Перевёл расчёт маршрутов на очередь задач, пиковая нагрузка выросла втрое без отказов.',
  'Стек: Node.js, PostgreSQL, RabbitMQ.',
  '',
  'Образование: МГТУ им. Баумана, информатика и вычислительная техника, 2017.',
].join('\n');

function newCandidate() {
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = randomBytes(3).toString('hex');
  return {
    displayName: 'QA Пилот',
    email: `qa-pilot-${stamp}-${suffix}@openqareer.com`,
    // Пароль случайный: он нужен только повторному входу этого же скрипта.
    password: `${randomBytes(12).toString('base64url')}-Qa1!`,
  };
}

function rememberCandidate(candidate) {
  const alreadyThere = readFileSync(ENV_FILE, 'utf8').includes('OPENQAREER_QA_CANDIDATE_USERNAME');
  const block =
    `\n# Синтетический кандидат для прогона первого запуска (INC-024), заведён ${new Date().toISOString()}\n` +
    `OPENQAREER_QA_CANDIDATE_USERNAME=${candidate.email}\n` +
    `OPENQAREER_QA_CANDIDATE_PASSWORD=${candidate.password}\n`;
  appendFileSync(ENV_FILE, block);
  return alreadyThere;
}

async function register(page, candidate) {
  // Оболочка приходит частями (338 кусков сборки): без явного ожидания
  // проверка спорит со скоростью загрузки, а не с продуктом.
  const accountButton = page.locator('[aria-label="Открыть аккаунт"]:visible').first();
  await accountButton.waitFor({ state: 'visible', timeout: 90_000 });
  // Кнопка аккаунта есть и в рельсе, и в мобильной шапке: жать нужно видимую.
  await accountButton.click();
  const dialog = page.getByRole('dialog', { name: 'Аккаунт' });
  await dialog.getByRole('button', { name: 'Создать аккаунт' }).click();
  await dialog.getByLabel('Как к вам обращаться').fill(candidate.displayName);
  await dialog.getByLabel('Email').fill(candidate.email);
  await dialog.getByLabel('Пароль').fill(candidate.password);
  await dialog.locator('#account-legal-consent').check();
  await dialog.getByRole('button', { name: 'Создать и начать' }).click();
  await page.waitForTimeout(4000);

  // Регистрация ограничена тремя за 30 минут. Отказ выглядит как обычный
  // экран, поэтому учётные данные пишутся в файл только после доказательства,
  // что сессия действительно заведена, — иначе в файле оседает имя
  // несуществующего кандидата (найдено собственным прогоном 2026-09-07).
  const session = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
    const body = response.ok ? await response.json() : null;
    return (body?.data ?? body)?.candidateId ?? null;
  });
  if (!session) {
    const complaint = await dialog
      .locator('[role="alert"]')
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(`регистрация не прошла: ${complaint?.trim() ?? 'сервер не завёл сессию'}`);
  }
}

async function completeWizard(page) {
  await page.getByRole('button', { name: /Хочу найти работу/ }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: 'Текстом', exact: true }).click();
  await page.locator('.career-source-step textarea').fill(RESUME);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: 'Собрать карьерную картину' }).click();
}

/**
 * Что экран утверждает и что в тот же момент отвечает сервер.
 *
 * Факты спрашиваются страницей памяти, а не головой снимка: голова память не
 * несёт (INC-030), и чтение `dossier.confirmedCount` показывало ноль там, где
 * у сервера лежали все факты — это была ошибка замера, а не продукта.
 */
async function compare(page) {
  return page.evaluate(async () => {
    const memory = await fetch('/api/v1/candidate/me/memory?offset=0', {
      credentials: 'include',
    });
    const body = memory.ok ? await memory.json() : null;
    const text = document.body.innerText;
    return {
      serverFacts: body?.meta?.total ?? null,
      saysNoFacts: /Фактов пока нет|Профиль пуст/u.test(text),
      saysImporting: /идёт импорт/iu.test(text),
    };
  });
}

/** Слушатели, которые доказывают судьбу самого запроса импорта. */
function watchImport(page, importCalls) {
  let startedAt = 0;
  page.on('request', (request) => {
    if (request.url().includes('/candidate/resume/import')) {
      startedAt = Date.now();
      importCalls.push('запрос ушёл');
    }
  });
  page.on('response', async (response) => {
    if (!response.url().includes('/candidate/resume/import')) return;
    const body = await response.text().catch(() => '(тело не прочитано)');
    let factCount = null;
    let structuredBy = null;
    try {
      const parsed = JSON.parse(body);
      factCount = parsed?.data?.factCount ?? null;
      structuredBy = parsed?.data?.structuredBy ?? parsed?.error?.code ?? null;
    } catch {
      structuredBy = '(тело не разобрано)';
    }
    // INC-037: время ответа — сама суть замера, а не подробность.
    importCalls.push(
      `ответ ${response.status()} за ${((Date.now() - startedAt) / 1000).toFixed(1)} с, ` +
        `фактов ${factCount}, разобрано: ${structuredBy}`,
    );
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('/candidate/resume/import')) {
      importCalls.push(`отказ запроса: ${request.failure()?.errorText}`);
    }
  });
}

/** Ждём фактов, а не фиксированной паузы: нетерпение проверки — не дефект. */
async function waitForFacts(page, limitMs) {
  let state = await compare(page);
  for (let waited = 0; waited < limitMs && (state.serverFacts ?? 0) === 0; waited += 15_000) {
    await page.waitForTimeout(15_000);
    state = await compare(page);
    process.stdout.write(`  ждём импорт… ${(waited + 15_000) / 1000} с, сервер: ${state.serverFacts}\n`);
  }
  return state;
}

/** Страница, которая записывает всё, на что потом ссылается вывод. */
async function openPage(browser, problems) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`page: ${e.message}`));
  return page;
}

async function run() {
  const candidate = newCandidate();
  const browser = await chromium.launch();
  const problems = [];
  const page = await openPage(browser, problems);

  const importCalls = [];
  watchImport(page, importCalls);

  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await register(page, candidate);
  const hadPrevious = rememberCandidate(candidate);
  process.stdout.write(
    `заведён кандидат ${candidate.email}` +
      `${hadPrevious ? ' (в файле уже был прежний — новый дописан ниже)' : ''}\n` +
      `пароль записан в ${ENV_FILE}, в вывод не попадает\n`,
  );

  await completeWizard(page);

  // Сразу после мастера: импорт ещё летит. Кабинет обязан сказать, что он идёт,
  // а не назвать ноль числом, которого он не знает.
  const during = await compare(page);
  process.stdout.write(
    `\nсразу после мастера: сервер ${during.serverFacts}, ` +
      `«идёт импорт» — ${during.saysImporting ? 'да' : 'нет'}, ` +
      `«фактов нет» — ${during.saysNoFacts ? 'да' : 'нет'}\n`,
  );
  if (!during.saysImporting && during.saysNoFacts) {
    problems.push('во время импорта кабинет уверенно утверждает, что фактов нет');
  }

  // Импорт на проде занимал 11.9 с (замер B160); после INC-037 у разбора есть
  // потолок в 45 с, поэтому четырёх минут ожидания заведомо достаточно.
  const after = await waitForFacts(page, 240_000);
  process.stdout.write(
    `после импорта: сервер ${after.serverFacts}, ` +
      `«фактов нет» на экране — ${after.saysNoFacts ? 'да' : 'нет'}\n`,
  );
  if ((after.serverFacts ?? 0) > 0 && after.saysNoFacts) {
    problems.push(
      `сервер вернул ${after.serverFacts} фактов, а кабинет говорит, что фактов нет (INC-024)`,
    );
  }

  process.stdout.write(
    `запрос импорта: ${importCalls.length > 0 ? importCalls.join(' | ') : 'НЕ УХОДИЛ'}\n`,
  );
  if (importCalls.length === 0) problems.push('запрос импорта резюме не уходил вовсе');

  await page.screenshot({ path: 'output/inc-024/first-run.png', fullPage: true });
  await browser.close();

  if (problems.length > 0) {
    process.stdout.write(`\nПРОВАЛ:\n- ${problems.join('\n- ')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('\nОК: первый прогон показывает то же число фактов, что и сервер.\n');
}

await run();
