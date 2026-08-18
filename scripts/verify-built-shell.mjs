import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
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
  let connectionCatalogRequests = 0;
  let hhConnected = true;
  let hhDisconnectAttempts = 0;
  let vacancyCreateSource = null;
  let createdVacancyView = null;
  await page.route((url) => url.pathname.startsWith('/api/v1/auth'), async (route) => {
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
  await page.route('**/api/v1/account', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          username: 'candidate.test',
          email: 'candidate@example.test',
          displayName: 'Тестовый кандидат',
          profile: {
            headline: 'Руководитель продукта',
            location: 'Москва',
            workMode: 'hybrid',
            updatedAt: '2026-08-13T08:00:00.000Z',
          },
          sessions: [],
        },
      }),
    });
  });
  await page.route('**/api/v1/candidate/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          candidate: {
            id: 'candidate-browser-test',
            dataClass: 'synthetic',
            locale: 'ru-RU',
            createdAt: '2026-08-13T08:00:00.000Z',
          },
          messages: [
            {
              id: 'message-long-user',
              role: 'user',
              content:
                'Это вымышленный тестовый карьерный эпизод: руководил запуском цифрового продукта для 1200 пользователей и сократил срок релиза на 30 процентов.',
            },
            {
              id: 'message-long-assistant',
              role: 'assistant',
              content:
                'Зафиксировал измеримый результат. Чтобы превратить его в полноценный карьерный эпизод, уточним роль, зону ответственности, период и ключевые решения.',
            },
          ],
          memory: [
            {
              id: 'confirmed-product-result',
              kind: 'fact',
              domain: 'outcome',
              statement:
                'Руководил запуском продукта для 1200 пользователей и сократил срок релиза на 30 процентов.',
              confidence: 'candidate-confirmed',
              sourceMessageIds: ['message-confirmed-result'],
              sensitive: false,
              status: 'confirmed',
            },
          ],
          turns: [],
          dossier: {
            sections: [],
            confirmedCount: 0,
            proposedCount: 0,
            readiness: { complete: false, unresolvedQuestions: 1, checks: [] },
          },
          assessments: [],
          germanyMarket: null,
          documents: [],
          vacancySubscriptions: createdVacancyView
            ? [createdVacancyView.subscription]
            : [],
        },
      }),
    });
  });
  await page.route('**/api/v1/candidate/vacancy-sources', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'hh',
            name: 'hh.ru',
            market: 'Россия и СНГ',
            transport: 'official_api',
            searchCoverage: 'Полный результат официального поиска в пределах API',
            attributionUrl: 'https://hh.ru/',
            documentationUrl: 'https://api.hh.ru/openapi/redoc',
            reviewedAt: '2026-08-13',
            health: {
              status: 'official_access_required',
              lastAttemptAt: '2026-08-13T08:00:00.000Z',
              lastSuccessAt: null,
              lastErrorCode: 'official_access_required',
              retryAfterAt: null,
              consecutiveFailures: 1,
            },
          },
          {
            id: 'remotive',
            name: 'Remotive',
            market: 'Международный remote',
            transport: 'public_api',
            searchCoverage: 'Совпадения в общей выборке до 50 remote-вакансий; задержка источника до 24 часов',
            attributionUrl: 'https://remotive.com/',
            documentationUrl: 'https://remotive.com/remote-jobs/api',
            reviewedAt: '2026-08-13',
            health: {
              status: 'healthy',
              lastAttemptAt: '2026-08-13T08:00:00.000Z',
              lastSuccessAt: '2026-08-13T08:00:00.000Z',
              lastErrorCode: null,
              retryAfterAt: null,
              consecutiveFailures: 0,
            },
          },
        ],
      }),
    });
  });
  await page.route('**/api/v1/candidate/vacancy-subscriptions', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: createdVacancyView }),
      });
      return;
    }
    const payload = route.request().postDataJSON();
    vacancyCreateSource = payload.source;
    createdVacancyView = {
      subscription: {
        id: '00000000-0000-4000-8000-000000000134',
        source: payload.source,
        query: payload.query,
        cadenceMinutes: payload.cadenceMinutes,
        status: 'active',
        nextRunAt: '2026-08-13T14:00:00.000Z',
        lastAttemptAt: '2026-08-13T08:00:00.000Z',
        lastSuccessAt: '2026-08-13T08:00:00.000Z',
        lastErrorCode: null,
        createdAt: '2026-08-13T08:00:00.000Z',
        updatedAt: '2026-08-13T08:00:00.000Z',
        analytics: {
          sampleSize: 1,
          sourceFound: 1,
          salaryKnown: 0,
          unknownSalary: 1,
          observedFrom: '2026-08-13T08:00:00.000Z',
          observedTo: '2026-08-13T08:00:00.000Z',
          currencies: [],
          topLocations: [{ location: 'Worldwide', vacancies: 1 }],
        },
      },
      vacancies: [
        {
          id: '00000000-0000-4000-8000-000000000535',
          source: payload.source,
          externalId: '535',
          title: 'Product Manager',
          company: 'Synthetic Company',
          location: 'Worldwide',
          sourceUrl: 'https://remotive.com/remote-jobs/product/product-manager-535',
          publishedAt: '2026-08-13T08:00:00.000Z',
          salary: null,
          workMode: 'remote',
          requirements: ['Product'],
          version: 1,
          firstSeenAt: '2026-08-13T08:00:00.000Z',
          lastSeenAt: '2026-08-13T08:00:00.000Z',
        },
      ],
    };
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ data: createdVacancyView }),
    });
  });
  await page.route('**/api/v1/candidate/vacancy-subscriptions/*/vacancies', async (route) => {
    await route.fulfill({
      status: createdVacancyView ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify({ data: createdVacancyView }),
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
  await page.route('**/api/v1/candidate/connections**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'GET' && pathname === '/api/v1/candidate/connections') {
      connectionCatalogRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              platform: 'linkedin',
              available: false,
              status: 'disconnected',
              capabilities: ['lite_identity'],
              importsCareerHistory: false,
            },
            hhConnected
              ? {
                  platform: 'hh',
                  available: true,
                  status: 'connected',
                  capabilities: ['profile_read', 'resume_read'],
                  importsCareerHistory: true,
                  scopes: ['applicant_resumes'],
                  accessTokenExpiresAt: null,
                  connectedAt: '2026-08-10T12:00:00.000Z',
                  profile: {
                    capturedAt: '2026-08-10T12:00:00.000Z',
                    sourceUrl: null,
                    facts: [],
                  },
                }
              : {
                  platform: 'hh',
                  available: true,
                  status: 'disconnected',
                  capabilities: ['profile_read', 'resume_read'],
                  importsCareerHistory: true,
                },
          ],
        }),
      });
      return;
    }
    if (request.method() === 'DELETE' && pathname.endsWith('/hh')) {
      hhDisconnectAttempts += 1;
      const localDataRemoved = hhDisconnectAttempts > 1;
      hhConnected = !localDataRemoved;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            platform: 'hh',
            status: 'disconnected',
            localDataRemoved,
            upstreamRevocation: 'unsupported',
          },
        }),
      });
      return;
    }
    await route.fallback();
  });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page:${error.message}`));
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
    errors.push(`request:${new URL(request.url()).pathname}`);
  });

  await page.route('**/*.oqpart-000.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });

  const startedAt = performance.now();
  await page.goto(`${baseUrl}?built-shell=${viewport.name}`, {
    waitUntil: 'commit',
  });
  const landingHeading = page.getByRole('heading', {
    name: 'Карьерная операционная система кандидата',
  });
  await landingHeading.waitFor({ state: 'visible', timeout: 2_000 });
  const shellMs = Math.round(performance.now() - startedAt);

  assert(
    (await page.locator('[data-bootstrap-shell="true"]').getAttribute('inert')) !== null,
    `${viewport.name}: shared shell was not prerendered before JavaScript`,
  );
  assert(
    (await page.getByRole('heading', { name: 'Карьерная операционная система кандидата' }).count()) === 1,
    `${viewport.name}: landing page heading is absent from initial HTML`,
  );

  await page.waitForFunction(
    () => !document.getElementById('root')?.hasAttribute('aria-busy'),
    undefined,
    { timeout: 15_000 },
  );
  const interactiveMs = Math.round(performance.now() - startedAt);

  await page.evaluate(() => {
    localStorage.setItem(
      'candidate-workspace',
      JSON.stringify({
        version: 6,
        careerGoal: 'find-job',
        resumeText: '',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        market: 'ru',
        currentSituation: 'Ищу продуктовую роль в сильной технологической компании.',
        constraints: 'Удалённый или гибридный формат.',
        urgency: 'active',
        createdAt: '2026-08-13T08:00:00.000Z',
        updatedAt: '2026-08-13T08:00:00.000Z',
        outcomes: [],
      }),
    );
    localStorage.setItem(
      'candidate-workspace-owner',
      'candidate-browser-test',
    );
  });

  // Navigate to candidate workspace
  await page.goto(`${baseUrl}app?built-shell=${viewport.name}`);
  const shell = page.getByTestId('career-shell');
  await shell.waitFor({ state: 'visible', timeout: 10_000 });

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

  assert(
    (await page.getByText('Посмотреть демо', { exact: true }).count()) === 0,
    `${viewport.name}: separate demo entry is still present`,
  );
  await page.getByRole('heading', { name: 'Карьерный кабинет' }).waitFor();
  await page.getByRole('heading', { name: 'Диалог со стратегом' }).waitFor();
  await page.getByRole('heading', { name: 'Рынок и следующие шаги' }).waitFor();
  await page.getByText('Что изменится', { exact: true }).waitFor();
  await page.getByText('Другой путь', { exact: true }).waitFor();
  await page.getByText('Исправить исходные данные', { exact: true }).waitFor();
  await page.getByText(/только после согласования кандидата/iu).waitFor();
  const dialogueContainment = await page
    .locator('.career-coach-history')
    .evaluate((history) => {
      const boundary = history
        .closest('.career-coach-desk')
        .getBoundingClientRect();
      const paragraphs = [...history.querySelectorAll('p')].map((paragraph) => {
        const rect = paragraph.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          clientWidth: paragraph.clientWidth,
          scrollWidth: paragraph.scrollWidth,
        };
      });
      return {
        contained: paragraphs.every(
          (paragraph) =>
            paragraph.left >= boundary.left - 1 &&
            paragraph.right <= boundary.right + 1 &&
            paragraph.scrollWidth <= paragraph.clientWidth + 1,
        ),
        boundary: {
          left: Math.round(boundary.left),
          right: Math.round(boundary.right),
        },
        paragraphs,
      };
    });
  assert(
    dialogueContainment.contained,
    `${viewport.name}: long dialogue text escaped its cabinet column ${JSON.stringify(dialogueContainment)}`,
  );
  const coachHeaderContained = await page
    .locator('.career-coach-desk .career-cabinet-panel-heading')
    .evaluate((header) => {
      const boundary = header
        .closest('.career-coach-desk')
        .getBoundingClientRect();
      return [...header.children].every((child) => {
        const rect = child.getBoundingClientRect();
        return rect.left >= boundary.left - 1 && rect.right <= boundary.right + 1;
      });
    });
  assert(
    coachHeaderContained,
    `${viewport.name}: coach status escaped its cabinet header`,
  );
  await page.locator('button[aria-label="Карьера"]:visible').click();
  await page.getByRole('heading', { name: 'Карьерный трек' }).waitFor();
  const roleCards = page.locator('.career-role-hypotheses article');
  assert(
    (await roleCards.count()) >= 1 && (await roleCards.count()) <= 3,
    `${viewport.name}: confirmed dialogue evidence did not create 1–3 roles`,
  );
  assert(
    /product/iu.test(await roleCards.allTextContents().then((items) => items.join(' '))),
    `${viewport.name}: role hypotheses lost the confirmed product signal`,
  );
  await page
    .locator('.career-track-timeline article')
    .filter({ hasText: 'Роль и рынок' })
    .getByText('В работе', { exact: true })
    .waitFor();
  const confirmedRoleMap = true;
  const adaptiveTrack = true;
  await page.screenshot({
    path: `output/playwright/b104-b105-b119-decision-${viewport.name}.png`,
    fullPage: true,
  });
  await page.locator('button[aria-label="Сегодня"]:visible').click();
  await page.getByRole('heading', { name: 'Карьерный кабинет' }).waitFor();
  await page.getByRole('combobox', { name: 'Источник вакансий' }).waitFor();
  // The source registry loads asynchronously, so wait for the honest health
  // line instead of counting a DOM that may not have rendered yet.
  const officialAccessNotice = page
    .getByText('нужен официальный доступ', { exact: false })
    .first();
  try {
    await officialAccessNotice.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    assert(false, `${viewport.name}: official access requirement is hidden`);
  }
  await page.getByRole('combobox', { name: 'Источник вакансий' }).selectOption(
    'remotive',
  );
  await page
    .getByText('Совпадения в общей выборке до 50 remote-вакансий', { exact: false })
    .waitFor();
  await page.getByRole('link', { name: 'Источник: Remotive' }).waitFor();
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({
    path: `output/playwright/b134-vacancy-sources-${viewport.name}.png`,
    fullPage: true,
  });
  await page.getByRole('textbox', { name: 'Роль или поисковый запрос' }).fill(
    'product manager',
  );
  const vacancyCreateResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        '/api/v1/candidate/vacancy-subscriptions',
  );
  await page.getByRole('button', { name: 'Создать' }).click();
  await vacancyCreateResponse;
  assert(
    vacancyCreateSource === 'remotive',
    `${viewport.name}: selected vacancy source was not sent to the API`,
  );
  const reasonedAction = true;
  await page.getByRole('link', { name: /Product Manager/ }).waitFor();
  await page.locator('button[aria-label="Профиль"]:visible').click();
  await page.getByRole('heading', { name: 'Профессиональный профиль' }).waitFor();
  await page.locator('button[aria-label="Сегодня"]:visible').click();
  await page.getByRole('heading', { name: 'Карьерный кабинет' }).waitFor();

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

  assert(
    connectionCatalogRequests === 0,
    `${viewport.name}: connection catalog loaded before the candidate opened account settings`,
  );
  await page.locator('button[aria-label="Открыть аккаунт"]:visible').last().click();
  await page.getByText('Вы вошли как', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Источники' }).click();
  await page.getByRole('heading', { name: 'Подключённые площадки' }).waitFor();
  await page.getByRole('button', { name: 'Отключить hh.ru' }).waitFor();
  assert(
    connectionCatalogRequests === 1,
    `${viewport.name}: account settings did not load one connection catalog`,
  );
  await page.getByRole('button', { name: 'Отключить hh.ru' }).click();
  await page.getByText('Не удалось удалить локальные данные hh.ru', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Отключить hh.ru' }).waitFor();
  await page
    .locator('.career-account-connection-list article')
    .filter({ hasText: 'hh.ru' })
    .getByText('Подключено', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Отключить hh.ru' }).click();
  await page.getByText('hh.ru отключён', { exact: false }).waitFor();
  const logoutResponse = page.waitForResponse((res) => res.url().includes('/api/v1/auth/logout'));
  await page.getByRole('button', { name: 'Выйти' }).click();
  await logoutResponse;
  await page.getByRole('heading', { name: 'Карьерная операционная система кандидата' }).waitFor();
  assert(
    (await page.getByRole('dialog', { name: 'Аккаунт' }).count()) === 0,
    `${viewport.name}: account panel remained open after logout`,
  );
  assert(
    (await page.evaluate(() => localStorage.getItem('candidate-workspace'))) === null,
    `${viewport.name}: logout retained candidate workspace`,
  );
  await page.goto(`${baseUrl}app?built-shell=${viewport.name}`);
  await page.getByRole('heading', { name: 'Начните с карьерного вопроса' }).waitFor();
  const accountRestart = true;

  await page.getByRole('button', { name: 'Начать диагностику' }).click();
  await page.getByRole('button', { name: /Хочу найти работу/ }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: 'LinkedIn' }).click();
  await page
    .locator('.career-source-fields')
    .getByRole('button', { name: 'Создать аккаунт' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Аккаунт' });
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: 'Создать аккаунт' }).click();
  await dialog.getByLabel('Как к вам обращаться').fill('Тестовый кандидат');
  await dialog.getByLabel('Email').fill('fresh.candidate@example.com');
  await dialog.getByLabel('Пароль').fill('fresh-candidate-password');
  await dialog.getByRole('button', { name: 'Создать и начать' }).click();
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
  const profileFactReview = true;
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('heading', { name: 'Что должно измениться?' }).waitFor();

  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: 'Без документов' }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByLabel('Что происходит сейчас?').fill(
    'Проверяю, что смена источника удаляет факты и ссылки от ранее выбранного профиля.',
  );
  await page.getByRole('button', { name: 'Собрать карьерную картину' }).click();
  await page.getByRole('heading', { name: 'Карьерный кабинет' }).waitFor();
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
  return {
    viewport: viewport.name,
    shellMs,
    interactiveMs,
    overflow,
    accountRestart,
    profileFactReview,
    confirmedRoleMap,
    reasonedAction,
    adaptiveTrack,
  };
}

async function verifyExpiredSessionRestore(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  let authenticated = false;
  await page.route((url) => url.pathname.startsWith('/api/v1/auth'), async (route) => {
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
  await page.route('**/api/v1/account', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          username: 'returning.candidate',
          email: null,
          displayName: 'Вернувшийся кандидат',
          profile: {
            headline: 'Руководитель продукта',
            location: null,
            workMode: null,
            updatedAt: null,
          },
          sessions: [],
        },
      }),
    });
  });
  await page.route('**/api/v1/candidate/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          candidate: {
            id: 'candidate-expired-session',
            dataClass: 'synthetic',
            locale: 'ru-RU',
            createdAt: '2026-08-10T00:00:00.000Z',
          },
          messages: [], memory: [], turns: [], assessments: [], documents: [],
          germanyMarket: null, vacancySubscriptions: [],
          dossier: {
            sections: [], confirmedCount: 0, proposedCount: 0,
            readiness: { complete: false, unresolvedQuestions: 1, checks: [] },
          },
        },
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
  await page.goto(`${baseUrl}app?expired-session-restore`, {
    waitUntil: 'networkidle',
  });
  await page.getByRole('heading', { name: 'Начните с карьерного вопроса' }).waitFor();
  await page.locator('button[aria-label="Открыть аккаунт"]:visible').last().click();
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByLabel('Логин').fill('returning.candidate');
  await page.getByLabel('Пароль').fill('returning-candidate-password');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByRole('heading', { name: 'Карьерный кабинет' }).waitFor();
  assert(
    (await page.evaluate(() => localStorage.getItem('candidate-workspace'))) !== null,
    'expired session: matching candidate workspace was deleted during login',
  );
  await context.close();
  return { matchingOwnerRestored: true };
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
    const result = await verifyViewport(browser, baseUrl, viewport);
    results.push(result);
    candidateResults.push({
      viewport: result.viewport,
      confirmedRoleMap: result.confirmedRoleMap,
      reasonedAction: result.reasonedAction,
      adaptiveTrack: result.adaptiveTrack,
    });
  }
  const sessionRestore = await verifyExpiredSessionRestore(browser, baseUrl);
  process.stdout.write(
    `${JSON.stringify({ status: 'pass', results, candidateResults, sessionRestore })}\n`,
  );
} finally {
  await browser.close();
  await server.close();
}
