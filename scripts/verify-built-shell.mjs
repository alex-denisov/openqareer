import { chromium } from 'playwright';
import { preview } from 'vite';

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyViewport(browser, baseUrl, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: 'reduce',
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  let authenticated = true;
  await page.route('**/api/v1/auth/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/logout')) authenticated = false;
    if (pathname.endsWith('/register') || pathname.endsWith('/login')) authenticated = true;
    if (request.method() === 'POST' && pathname.endsWith('/logout')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: pathname.endsWith('/register') ? 201 : 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: authenticated
          ? { username: pathname.endsWith('/register') ? 'fresh.candidate' : 'candidate.test', role: 'candidate', isTest: !pathname.endsWith('/register'), candidateId: 'candidate-browser-test' }
          : null,
      }),
    });
  });
  await page.route('**/api/v1/candidate/profile-imports', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          status: 'imported',
          platform: 'linkedin',
          sourceUrl: 'https://www.linkedin.com/in/synthetic-candidate',
          capturedAt: '2026-08-10T00:00:00.000Z',
          accessPath: 'official_api',
          facts: [
            { kind: 'headline', value: 'Synthetic Product Lead', sourceLocator: 'public-meta:1', confidence: 'public-metadata' },
            { kind: 'summary', value: 'Builds evidence-led products.', sourceLocator: 'public-meta:2', confidence: 'public-metadata' },
          ],
        },
      }),
    });
  });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page:${error.message}`));
  page.on('requestfailed', (request) =>
    errors.push(`request:${new URL(request.url()).pathname}`),
  );

  await page.route('**/*.oqpart-000.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });

  const startedAt = performance.now();
  await page.goto(`${baseUrl}?built-shell=${viewport.name}`, {
    waitUntil: 'commit',
  });
  const shell = page.getByTestId('career-shell');
  await shell.waitFor({ state: 'visible', timeout: 2_000 });
  const shellMs = Math.round(performance.now() - startedAt);

  assert(
    (await page.locator('[data-bootstrap-shell="true"]').getAttribute('inert')) !== null,
    `${viewport.name}: shared shell was not prerendered before JavaScript`,
  );
  assert(
    (await page.getByRole('heading', { name: 'Начните с карьерного вопроса' }).count()) === 1,
    `${viewport.name}: useful first decision is absent from initial HTML`,
  );
  for (const label of ['Сегодня', 'Профиль', 'Карьера', 'Возможности']) {
    assert(
      (await page.locator(`button[aria-label="${label}"]`).count()) >= 2,
      `${viewport.name}: invariant navigation is missing ${label}`,
    );
  }
  assert(
    (await page.getByText('Загружаем рабочее пространство').count()) === 0,
    `${viewport.name}: loading-only copy returned`,
  );

  await page.waitForFunction(
    () => !document.getElementById('root')?.hasAttribute('aria-busy'),
    undefined,
    { timeout: 15_000 },
  );
  const interactiveMs = Math.round(performance.now() - startedAt);

  assert(
    (await page.getByText('Посмотреть демо', { exact: true }).count()) === 0,
    `${viewport.name}: separate demo entry is still present`,
  );
  await page.getByRole('button', { name: 'Начать диагностику' }).click();
  await page.getByRole('heading', { name: 'С чем разобраться?' }).waitFor();
  await page.getByRole('button', { name: /Хочу найти работу/ }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('heading', { name: 'Что уже есть?' }).waitFor();
  await page.getByRole('button', { name: 'Без документов' }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('heading', { name: 'Что должно измениться?' }).waitFor();

  await page.getByLabel('Что происходит сейчас?').fill(
    'После смены позиционирования стало меньше приглашений, хочу понять следующий карьерный шаг.',
  );
  await page.getByRole('button', { name: 'Собрать карьерную картину' }).click();
  await page.getByRole('heading', { name: 'Что можно сказать уже сейчас' }).waitFor();
  assert(
    await page.locator('button[aria-label="Профиль"]:visible').isEnabled(),
    `${viewport.name}: real candidate workspace is inaccessible after intake`,
  );
  await page.locator('button[aria-label="Карьера"]:visible').click();
  await page.getByRole('heading', { name: 'Карьера', exact: true }).waitFor();
  assert(
    (await page.evaluate(() => localStorage.getItem('candidate-workspace'))) !== null,
    `${viewport.name}: candidate progress was not saved`,
  );

  const tariffsButton = page
    .locator(
      '.career-mobile-tariffs:visible, .career-rail-bottom .career-nav-button:visible',
    )
    .first();
  await tariffsButton.click();
  await page.getByRole('heading', { name: 'Сколько делать за вас' }).waitFor();
  assert(
    (await page.locator('button[aria-label="Профиль"]:visible').count()) === 1,
    `${viewport.name}: Profile disappeared after navigation`,
  );

  await page.locator('button[aria-label="Открыть аккаунт"]:visible').last().click();
  await page.getByText('Вы вошли как', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Выйти и начать заново' }).click();
  await page.getByRole('heading', { name: 'Начните с карьерного вопроса' }).waitFor();
  assert(
    (await page.getByRole('dialog', { name: 'Аккаунт' }).count()) === 0,
    `${viewport.name}: account panel remained open after logout`,
  );
  assert(
    (await page.evaluate(() => localStorage.getItem('candidate-workspace'))) === null,
    `${viewport.name}: logout retained candidate workspace`,
  );
  await page.locator('button[aria-label="Открыть аккаунт"]:visible').last().click();
  await page.getByRole('button', { name: /Создать новый аккаунт/ }).waitFor();
  await page.getByRole('button', { name: /Создать новый аккаунт/ }).click();
  await page.getByLabel('Логин').fill('fresh.candidate');
  await page.getByLabel('Пароль').fill('fresh-candidate-password');
  await page.getByRole('button', { name: 'Создать и начать' }).click();
  await page.getByRole('heading', { name: 'Начните с карьерного вопроса' }).waitFor();

  await page.getByRole('button', { name: 'Начать диагностику' }).click();
  await page.getByRole('button', { name: /Хочу найти работу/ }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: 'LinkedIn' }).click();
  await page.getByLabel('Ссылка на профиль').fill('https://www.linkedin.com/in/synthetic-candidate');
  await page.getByRole('button', { name: 'Проверить способ импорта' }).click();
  await page.getByText('Найдено: 2', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByText('Проверьте каждый найденный факт', { exact: false }).waitFor();
  const headlineFact = page.getByRole('group', { name: 'Заголовок профиля' });
  await headlineFact.getByRole('button', { name: 'Подтвердить' }).click();
  const summaryFact = page.getByRole('group', { name: 'Описание профиля' });
  await summaryFact.getByRole('textbox').fill('Builds evidence-led products with candidate-reviewed facts.');
  await summaryFact.getByRole('button', { name: 'Подтвердить' }).click();
  await summaryFact.getByRole('button', { name: 'Исправлено' }).waitFor();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('heading', { name: 'Что должно измениться?' }).waitFor();

  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: 'Без документов' }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByLabel('Что происходит сейчас?').fill(
    'Проверяю, что смена источника удаляет факты и ссылки от ранее выбранного профиля.',
  );
  await page.getByRole('button', { name: 'Собрать карьерную картину' }).click();
  await page.getByRole('heading', { name: 'Что можно сказать уже сейчас' }).waitFor();
  const sourceCleanWorkspace = JSON.parse(
    await page.evaluate(() => localStorage.getItem('candidate-workspace')),
  );
  assert(
    sourceCleanWorkspace.resumeText === ''
      && sourceCleanWorkspace.linkedinUrl === undefined
      && sourceCleanWorkspace.hhUrl === undefined
      && sourceCleanWorkspace.profileFacts?.length !== 2,
    `${viewport.name}: source switch retained stale profile evidence`,
  );

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert(overflow <= 1, `${viewport.name}: horizontal overflow is ${overflow}px`);
  assert(errors.length === 0, `${viewport.name}: ${errors.join(', ')}`);
  await context.close();
  return { viewport: viewport.name, shellMs, interactiveMs, overflow, accountRestart: true, profileFactReview: true };
}

async function verifyExpiredSessionRestore(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  let authenticated = false;
  await page.route('**/api/v1/auth/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/login')) authenticated = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: authenticated
          ? {
              username: 'returning.candidate',
              role: 'candidate',
              isTest: true,
              candidateId: 'candidate-expired-session',
            }
          : null,
      }),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      'candidate-workspace',
      JSON.stringify({
        version: 6,
        careerGoal: 'find-job',
        resumeText: '',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        market: 'ru',
        currentSituation:
          'Возвращаюсь в сохранённую карьерную картину после истечения браузерной сессии.',
        constraints: '',
        urgency: 'active',
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-10T00:00:00.000Z',
        outcomes: [],
      }),
    );
    localStorage.setItem(
      'candidate-workspace-owner',
      'candidate-expired-session',
    );
  });
  await page.goto(`${baseUrl}?expired-session-restore`, {
    waitUntil: 'networkidle',
  });
  await page.getByRole('heading', { name: 'Начните с карьерного вопроса' }).waitFor();
  await page.locator('button[aria-label="Открыть аккаунт"]:visible').last().click();
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByLabel('Логин').fill('returning.candidate');
  await page.getByLabel('Пароль').fill('returning-candidate-password');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByRole('heading', { name: 'Что можно сказать уже сейчас' }).waitFor();
  assert(
    (await page.evaluate(() => localStorage.getItem('candidate-workspace'))) !== null,
    'expired session: matching candidate workspace was deleted during login',
  );
  await context.close();
  return { matchingOwnerRestored: true };
}

async function verifyCandidateResult(browser, baseUrl, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: 'reduce',
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          username: 'candidate.result',
          role: 'candidate',
          isTest: true,
          candidateId: `candidate-result-${viewport.name}`,
        },
      }),
    });
  });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page:${error.message}`));
  page.on('requestfailed', (request) =>
    errors.push(`request:${new URL(request.url()).pathname}`),
  );
  await page.addInitScript(() => {
    if (localStorage.getItem('candidate-workspace')) return;
    localStorage.setItem(
      'candidate-workspace',
      JSON.stringify({
        version: 6,
        careerGoal: 'find-job',
        resumeText: '',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        market: 'ru',
        currentSituation:
          'ПослеСменыПозиционированияСталоЗаметноМеньшеПриглашенийНаИнтервьюИПокаНеПонятноЧтоИменноМешаетСледующемуШагу',
        constraints: 'Удалённая работа, без переезда в ближайшие шесть месяцев.',
        urgency: 'active',
        createdAt: '2026-08-09T17:00:00.000Z',
        updatedAt: '2026-08-09T17:00:00.000Z',
        outcomes: [],
      }),
    );
    localStorage.setItem(
      'candidate-workspace-owner',
      `candidate-result-${window.innerWidth >= 1000 ? 'desktop' : 'mobile'}`,
    );
  });
  await page.goto(`${baseUrl}?candidate-result=${viewport.name}`, {
    waitUntil: 'networkidle',
  });
  await page
    .getByRole('heading', { name: 'Что можно сказать уже сейчас' })
    .waitFor();
  await page.getByText('Цель: найти работу', { exact: true }).waitFor();
  await page
    .getByRole('heading', { name: 'Сначала проверим основу поиска' })
    .waitFor();
  assert(
    (await page
      .getByText('Не вывод: пока нет доказательств опыта', { exact: false })
      .count()) === 1,
    `${viewport.name}: honest free diagnostic is absent`,
  );
  const todayWidth = await page.locator('.career-today-view').evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  if (viewport.name === 'desktop') {
    assert(
      todayWidth >= 760,
      `desktop: candidate result is only ${todayWidth}px wide`,
    );
  }
  await page.locator('button[aria-label="Профиль"]:visible').click();
  await page.getByRole('heading', { name: 'Профиль' }).waitFor();
  const profileOverflow = await page.locator('.career-profile-overview').evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  assert(
    profileOverflow <= 1,
    `${viewport.name}: profile overview clips by ${profileOverflow}px`,
  );

  await page.evaluate(() => {
    const now = new Date().toISOString();
    localStorage.setItem(
      'candidate-workspace',
      JSON.stringify({
        version: 6,
        careerGoal: 'find-job',
        resumeText:
          'Руководил продуктовой командой из восьми человек. Запустил новый процесс исследования клиентов. Сократил срок проверки продуктовых гипотез на 30 процентов. Отвечал за планирование, метрики и взаимодействие с коммерческой командой.',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        market: 'ru',
        currentSituation:
          'После смены позиционирования получаю мало приглашений и проверяю основу поиска.',
        constraints: 'Удалённая работа.',
        urgency: 'active',
        createdAt: now,
        updatedAt: now,
        analysis: {
          evidenceMethodVersion: 'evidence-local-v1',
          roleMethodVersion: 'role-hypotheses-local-v1',
          evidenceItems: [
            {
              id: 'ev-01',
              kind: 'scope',
              sourceExcerpt: 'Руководил продуктовой командой из восьми человек.',
              statement: 'Руководил продуктовой командой из восьми человек.',
              status: 'confirmed',
              userEdited: false,
            },
            {
              id: 'ev-02',
              kind: 'result',
              sourceExcerpt:
                'Сократил срок проверки продуктовых гипотез на 30 процентов.',
              statement:
                'Сократил срок проверки продуктовых гипотез на 30 процентов.',
              status: 'confirmed',
              userEdited: false,
            },
            {
              id: 'ev-03',
              kind: 'responsibility',
              sourceExcerpt:
                'Отвечал за планирование, метрики и взаимодействие с коммерческой командой.',
              statement:
                'Отвечал за планирование, метрики и взаимодействие с коммерческой командой.',
              status: 'confirmed',
              userEdited: false,
            },
          ],
          questions: [],
          roleHypotheses: [
            {
              id: 'role-target',
              title: 'Руководитель продукта',
              fitState: 'plausible',
              basis: 'Опирается на три подтверждённых факта из резюме.',
              evidenceIds: ['ev-01', 'ev-02', 'ev-03'],
              gaps: ['Нужна свежая рыночная выборка.'],
            },
          ],
          reviewedAt: now,
        },
        outcomes: [],
      }),
    );
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('button[aria-label="Карьера"]:visible').click();
  await page.getByRole('heading', { name: 'Карьера' }).waitFor();
  const routeStep = page.locator('.career-track li', { hasText: 'Роль и рынок' });
  const routeStepClass = await routeStep.getAttribute('class');
  const routeDebug = {
    track: await routeStep.textContent(),
    roles: await page.locator('.career-role-row').count(),
    storedVersion: await page.evaluate(
      () => JSON.parse(localStorage.getItem('candidate-workspace') ?? '{}').version,
    ),
  };
  assert(
    routeStepClass?.includes('is-active'),
    `${viewport.name}: role and market class before a sample is ${routeStepClass} ${JSON.stringify(routeDebug)}`,
  );
  await page.locator('button[aria-label="Возможности"]:visible').click();
  await page
    .getByText('Сначала завершим бесплатную проверку маршрута', { exact: true })
    .waitFor();
  assert(
    (await page.getByRole('button', { name: 'Посмотреть объём работы' }).count()) ===
      0,
    `${viewport.name}: paid setup was offered before the free route was grounded`,
  );
  const tariffsButton = page
    .locator(
      '.career-mobile-tariffs:visible, .career-rail-bottom .career-nav-button:visible',
    )
    .first();
  await tariffsButton.click();
  for (const status of [
    'Доступно сейчас',
    'Сопровождаемый пилот',
    'Автопилот пока недоступен',
  ]) {
    assert(
      (await page.getByText(status, { exact: false }).count()) >= 1,
      `${viewport.name}: tariff boundary is missing ${status}`,
    );
  }

  await page.evaluate(() => {
    const workspace = JSON.parse(
      localStorage.getItem('candidate-workspace') ?? '{}',
    );
    const now = new Date().toISOString();
    localStorage.setItem(
      'candidate-workspace',
      JSON.stringify({
        ...workspace,
        marketSample: {
          source: 'hh',
          query: 'Руководитель продукта',
          found: 42,
          fetchedAt: now,
          items: Array.from({ length: 5 }, (_, index) => ({
            id: `vacancy-${index + 1}`,
            title: 'Руководитель продукта',
            company: `Компания ${index + 1}`,
            location: 'Москва',
            sourceUrl: `https://hh.ru/vacancy/${index + 1}`,
            publishedAt: null,
            salary: null,
          })),
        },
        updatedAt: now,
      }),
    );
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('button[aria-label="Карьера"]:visible').click();
  await page.getByRole('heading', { name: 'Карьера' }).waitFor();
  assert(
    (await page.locator('.career-track li', { hasText: 'Роль и рынок' }).getAttribute('class'))?.includes(
      'is-complete',
    ),
    `${viewport.name}: fresh market sample did not complete the route step`,
  );
  await page.locator('button[aria-label="Возможности"]:visible').click();
  await page
    .getByText('Можно подключить сопровождаемую настройку поиска', {
      exact: true,
    })
    .waitFor();
  await page.getByRole('textbox', { name: 'Название роли' }).fill(
    'Senior Product Manager',
  );
  await page.getByRole('textbox', { name: 'Компания' }).fill('Компания Пример');
  await page.getByRole('textbox', { name: 'Текст вакансии' }).fill(`
Задачи
Формировать продуктовую стратегию и руководить продуктовой командой.
Требования
Опыт работы с продуктовыми метриками и планированием.
Уверенное владение SQL для продуктовой аналитики.
Условия
Гибридный формат работы, полная занятость.
`);
  await page.getByRole('button', { name: 'Проверить возможность' }).click();
  await page.getByRole('heading', { name: 'Почему такой маршрут' }).waitFor();
  assert(
    (await page.getByText('Есть опора в профиле', { exact: true }).count()) >= 1,
    `${viewport.name}: opportunity comparison has no evidence-backed match`,
  );
  assert(
    (await page.getByText('Нужно подтвердить', { exact: true }).count()) >= 1,
    `${viewport.name}: unsupported SQL requirement was not exposed as a gap`,
  );
  await page
    .getByRole('textbox', { name: 'Почему это разумный следующий шаг?' })
    .fill('Сначала уточню scope роли и формат работы у команды.');
  await page
    .getByRole('button', { name: 'Сначала найти контакт Рекомендуется' })
    .click();
  await page.getByText('Решение сохранено', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Пакет следующего действия' }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page
    .getByRole('heading', {
      name: 'Сделаем первый контакт по выбранной вакансии',
    })
    .waitFor();
  await page.locator('button[aria-label="Карьера"]:visible').click();
  assert(
    (await page.locator('.career-track li', { hasText: 'Позиционирование' }).getAttribute('class'))?.includes(
      'is-complete',
    ),
    `${viewport.name}: positioning did not complete after the action package`,
  );
  assert(
    (await page.locator('.career-track li', { hasText: 'Кампания поиска' }).getAttribute('class'))?.includes(
      'is-active',
    ),
    `${viewport.name}: campaign did not become active after the action package`,
  );
  await page.locator('button[aria-label="Возможности"]:visible').click();
  await page.getByText('Решение сохранено', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Пакет следующего действия' }).waitFor();
  await page.getByRole('button', { name: 'Отметить отправку' }).click();
  await page.getByText('Следующий шаг по факту', { exact: true }).waitFor();
  await page
    .getByRole('heading', { name: 'Назначить дату проверки ответа' })
    .waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page
    .getByRole('heading', { name: 'Назначить дату проверки ответа' })
    .waitFor();
  await page.locator('button[aria-label="Возможности"]:visible').click();
  await page
    .getByRole('button', { name: 'Получен положительный ответ' })
    .waitFor();
  assert(errors.length === 0, `${viewport.name}: ${errors.join(', ')}`);
  await context.close();
  return {
    viewport: viewport.name,
    todayWidth,
    profileOverflow,
    freeBoundary: true,
    assistedBoundary: true,
    opportunityPackage: true,
    adaptiveNextAction: true,
    outcomeLoop: true,
  };
}

const server = await preview({
  logLevel: 'silent',
  preview: { host: '127.0.0.1', port: 0 },
});
const address = server.httpServer.address();
if (!address || typeof address === 'string') {
  await server.close();
  throw new Error('preview server did not expose a local port');
}

const browser = await chromium.launch({ headless: true });
try {
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  const results = [];
  const candidateResults = [];
  for (const viewport of viewports) {
    results.push(await verifyViewport(browser, baseUrl, viewport));
    candidateResults.push(
      await verifyCandidateResult(browser, baseUrl, viewport),
    );
  }
  const sessionRestore = await verifyExpiredSessionRestore(browser, baseUrl);
  process.stdout.write(
    `${JSON.stringify({ status: 'pass', results, candidateResults, sessionRestore })}\n`,
  );
} finally {
  await browser.close();
  await server.close();
}
