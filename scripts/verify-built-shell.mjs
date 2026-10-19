import { verifyCoachDelivery } from './verify-coach-delivery.mjs';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { preview } from 'vite';

const BROWSER_WALK_MESSAGES = [
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
];

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  // Окно .app: 1176 px — шесть кнопок строки обязаны стоять в один ряд (B236).
  { name: 'app-window', width: 1176, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function openHhConnectionManagement(page, viewport) {
  const account = page.getByTestId('career-shell').getByRole('main');
  if (viewport.width <= 760) {
    await account.locator('.career-account-mobile-row').filter({ hasText: 'hh.ru' }).click();
    return;
  }
  await account.getByRole('button', { name: 'Управлять' }).click();
}

/** 1440 opens account and tariffs from the rail; 390 reaches them through the «Ещё» menu. */
async function openFromShell(page, label, railSelector) {
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await page
      .getByRole('navigation', { name: 'Разделы' })
      .getByRole('button', { name: 'Ещё' })
      .click();
    await page.getByRole('menuitem', { name: label }).click();
    return;
  }
  await page.locator(railSelector).first().click();
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
  let createdVacancyView = null;
  let savedCampaign = null;
  // B159: собранный каркас спрашивает у продакшена его SHA, чтобы сказать
  // кандидату, отстала ли сборка. В гейте бэкенда нет, поэтому `/health`
  // отвечает тем же, чем прод, — сорока символами SHA.
  await page.route(
    (url) => url.pathname === '/health',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: 'b159b159b159b159b159b159b159b159b159b159',
      });
    },
  );
  // B334: лендинг спрашивает, опубликована ли сборка для macOS.
  await page.route('**/api/v1/desktop/macos', async (route) => {
    await route.fulfill({ json: { data: { available: false } } });
  });
  // Unknown candidate reads remain unavailable in this isolated browser fixture;
  // they must not imitate an expired session and clear the synthetic identity.
  await page.route('**/api/v1/candidate/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: null }),
    });
  });
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/auth'),
    async (route) => {
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
            ? {
                username: pathname.endsWith('/register') ? 'fresh.candidate' : 'candidate.test',
                role: 'candidate',
                isTest: !pathname.endsWith('/register'),
                candidateId: 'candidate-browser-test',
              }
            : null,
        }),
      });
    },
  );
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
  await page.route('**/api/v1/account/email-change-requests/current', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: null }),
    });
  });
  // The candidate workspace is server-owned; a profileless fixture starts empty.
  await page.route('**/api/v1/candidate/workspace', async (route) => {
    const request = route.request();
    if (request.method() === 'PUT') {
      const body = JSON.parse(request.postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: body.workspace ?? null }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: null }),
    });
  });
  await page.route('**/api/v1/candidate/drafts/topics**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          items: [],
          total: 0,
          cadence: {
            timezone: 'Europe/Moscow',
            lastPublishedAt: null,
            nextAllowedAt: null,
            canPublish: false,
          },
        },
      }),
    });
  });
  await page.route('**/api/v1/candidate/companies**', async (route) => {
    const requestUrl = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          items: [],
          total: 0,
          offset: Number(requestUrl.searchParams.get('offset') ?? 0),
          limit: 20,
          sort: requestUrl.searchParams.get('sort') ?? 'default',
          filter: requestUrl.searchParams.get('filter') ?? 'all',
          filterCounts: { all: 0, want: 0, contacts: null, recruiter: 0 },
          linkedin: { status: 'disconnected', importedAt: null, contactsImported: false },
          searchConsentGranted: false,
        },
      }),
    });
  });
  // The shell reads diary access as soon as a candidate session mounts. Keep
  // this build-only fixture in the honest empty state instead of allowing the
  // shared local API's no-session 401 to expire the synthetic browser session.
  await page.route('**/api/v1/candidate/career-diary**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/v1/candidate/career-diary') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            asOf: '2026-10-12',
            primaryWorkplace: null,
            summary: {
              goalsAchieved: 0,
              goalsAtRisk: 0,
              goalsTotal: 0,
              achievementsReadyToAdd: 0,
              weeklyReviewsTotal: 0,
              weeklyReviewsInRow: 0,
            },
          },
        }),
      });
      return;
    }
    if (pathname === '/api/v1/candidate/career-diary/workplaces') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { items: [], nextCursor: null } }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: '{"error":{"code":"not_found"}}',
    });
  });
  await page.route('**/api/v1/candidate/billing', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          currentPlan: 'basic',
          subscription: {
            status: 'active',
            currentPeriodEndsAt: '2026-11-08T00:00:00.000Z',
            nextChargeAt: '2026-11-08T00:00:00.000Z',
            autoRenew: true,
          },
          plans: [
            {
              id: 'basic',
              name: 'Basic',
              amountKopecks: 399000,
              currency: 'RUB',
              interval: 'month',
            },
            { id: 'pro', name: 'Pro', amountKopecks: 990000, currency: 'RUB', interval: 'month' },
            { id: 'max', name: 'Max', amountKopecks: 3990000, currency: 'RUB', interval: 'month' },
          ],
        },
      }),
    });
  });
  await page.route('**/api/v1/candidate/billing/receipts**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], meta: { nextCursor: null } }),
    });
  });
  await page.route('**/api/v1/candidate/campaign', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      savedCampaign = {
        roles: {
          value: body.roles.map((role) => (typeof role === 'string' ? role : role.title)),
          origin: 'explicit',
        },
        regions: { value: body.regions, origin: 'explicit' },
        remoteOnly: body.remoteOnly ?? false,
      };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: savedCampaign }),
    });
  });
  // Диалог не едет в снимке — его читают отдельной страницей (INC-030).
  await page.route('**/api/v1/candidate/me/messages*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: BROWSER_WALK_MESSAGES,
        meta: { total: BROWSER_WALK_MESSAGES.length, offset: 0, nextOffset: null },
      }),
    });
  });
  await page.route('**/api/v1/candidate/me*', async (route) => {
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
          importedSources: [
            {
              platform: 'hh',
              connectedAt: '2026-08-10T12:00:00.000Z',
              lastImportedAt: '2026-08-10T12:00:00.000Z',
              factCount: 9,
            },
          ],
          messages: BROWSER_WALK_MESSAGES,
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
            {
              id: 'imported-responsibility',
              kind: 'fact',
              domain: 'responsibility',
              statement: 'Отвечал за продуктовую аналитику трёх направлений.',
              confidence: 'candidate-reported',
              sourceMessageIds: ['message-import'],
              sensitive: false,
              status: 'proposed',
            },
          ],
          turns: [],
          dossier: {
            sections: [],
            // Сервер считает эти числа из той же памяти (server/domain/dossier.ts),
            // поэтому заглушка обязана согласовываться с фактом выше — иначе гейт
            // проверяет экран на данных, которых прод никогда не отдаст.
            confirmedCount: 1,
            proposedCount: 0,
            readiness: { complete: false, unresolvedQuestions: 1, checks: [] },
          },
          assessments: [],
          germanyMarket: null,
          // «Главная» — это профиль из разобранного резюме (B179). Без него
          // гейт проверял бы пустой экран вместо того, ради чего он есть.
          resume: {
            createdAt: '2026-08-30T10:00:00.000Z',
            updatedAt: '2026-09-01T09:00:00.000Z',
            draft: {
              candidate: {
                fullName: 'Мария Иванова',
                about: 'Продуктовый аналитик с опытом запуска аналитики в финтехе.',
                contact: { location: 'Москва, Россия' },
              },
              targetRole: 'Продуктовый аналитик',
              experience: [
                {
                  id: 'exp-1',
                  chronologyMemoryId: 'imported-responsibility',
                  title: 'Продуктовый аналитик',
                  employer: 'FinCloud',
                  startDate: '2023-01',
                  current: true,
                  bulletMemoryIds: ['confirmed-product-result', 'imported-responsibility'],
                },
              ],
              skills: [{ id: 'skill-1', name: 'Продуктовая аналитика' }],
              education: [
                {
                  id: 'edu-1',
                  evidenceMemoryId: 'imported-responsibility',
                  institution: 'МГУ',
                  qualification: 'Прикладная математика',
                  startDate: '2012',
                  endDate: '2016',
                },
              ],
              languages: [
                { id: 'lang-1', evidenceMemoryId: 'imported-responsibility', name: 'Английский' },
              ],
            },
          },
          documents: [],
          vacancySubscriptions: createdVacancyView ? [createdVacancyView.subscription] : [],
        },
      }),
    });
  });
  // The cabinet reads the resume alongside the account and the dossier, so the
  // walk must answer it too; an unstubbed 401 would surface as a console error.
  await page.route('**/api/v1/candidate/resume', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          draft: {
            schemaVersion: 2,
            candidate: {
              fullName: 'Марина Соколова',
              headline: 'VP of Engineering',
              about: 'Строю инженерные организации в финтехе.',
              contact: {
                email: 'm.sokolova@example.com',
                phone: null,
                telegram: null,
                location: 'Берлин, Германия',
                links: [],
                linkedinUrl: null,
              },
            },
            targetRole: 'VP of Engineering',
            experience: [
              {
                id: 'exp-1',
                chronologyMemoryId: 'mem-exp-1',
                title: 'VP of Engineering',
                employer: 'FinNova Bank',
                employerGroupKey: 'finnova-bank',
                location: 'Берлин, Германия',
                startDate: 'янв 2023',
                current: true,
                bulletMemoryIds: [],
                employmentType: 'Полная занятость',
                workplaceType: 'hybrid',
                skills: ['Platform Strategy'],
              },
            ],
            skills: [{ id: 'skill-1', name: 'Engineering Leadership' }],
            education: [],
            courses: [],
            tests: [],
            recommendations: [],
            languages: [],
            achievements: [],
          },
          savedAt: {
            createdAt: '2026-09-21T09:00:00.000Z',
            updatedAt: '2026-09-21T09:00:00.000Z',
          },
          projection: {
            master: {
              kind: 'master',
              targetRole: null,
              contact: { fullName: null, email: null, phone: null, location: null, links: [] },
              experience: [],
              education: [],
              languages: [],
              unknowns: [],
              conventions: {
                country: null,
                packVersion: null,
                reverseChronological: true,
                maxPages: null,
                recommendedBulletsPerRole: null,
                photo: 'omitted',
                discriminatoryPii: 'omitted',
              },
              length: { lines: 0, pages: 1, linesPerPage: 45 },
            },
            germanyVariant: {
              kind: 'country-role',
              targetRole: null,
              contact: { fullName: null, email: null, phone: null, location: null, links: [] },
              experience: [],
              education: [],
              languages: [],
              unknowns: [],
              conventions: {
                country: 'DE',
                packVersion: 'DE-CV-2026.1',
                reverseChronological: true,
                maxPages: 2,
                recommendedBulletsPerRole: { min: 3, max: 5 },
                photo: 'omitted',
                discriminatoryPii: 'omitted',
              },
              length: { lines: 0, pages: 1, linesPerPage: 45 },
            },
            evidenceSnapshot: [],
            excludedEvidenceIds: [],
          },
          evidenceFreshness: { stale: [], approvedCount: 0 },
        },
      }),
    });
  });
  // B249: рассказ «своими словами» шлёт текст на тот же импорт, что PDF и
  // коннекторы; без ответа тут шаг «Расскажу сам» падал бы 502-м на «Продолжить».
  await page.route('**/api/v1/candidate/resume/import', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          parsed: { rawText: route.request().postDataJSON()?.text ?? '', sections: [] },
          resume: { draft: null, savedAt: null },
          structuredBy: 'rules',
          factCount: 2,
        },
      }),
    });
  });
  // B266: экран «Тарифы» спрашивает уже отправленные заявки на план.
  await page.route('**/api/v1/candidate/plan-requests', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  // B318: «Сегодня» показывает последние черновики LinkedIn; без ответа
  // прогон записывал 502, который увидел бы и кандидат (B331).
  await page.route('**/api/v1/candidate/drafts*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  // Гипотезы роли считает сервер (B180, срез 1б): «Главная» спрашивает их
  // отдельным маршрутом, и без ответа прогон записал бы 502, который увидел бы
  // и кандидат. Отвечаем одной настоящей гипотезой — панель должна печатать
  // рыночное имя роли, а не отказ.
  await page.route('**/api/v1/candidate/role-hypotheses*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'role-analyst',
            title: 'Продуктовый аналитик',
            origin: 'model',
            reason: 'вели продуктовую аналитику четыре года',
            evidenceRefs: ['memory:1'],
            confirmation: {
              state: 'observed',
              sampleSize: 12,
              observedFrom: '2026-08-20T08:00:00.000Z',
              observedTo: '2026-09-01T08:00:00.000Z',
              sources: [{ source: 'hh', count: 12 }],
              repeatedRequirements: ['SQL', 'A/B тесты'],
              matchedRequirements: 2,
            },
          },
          {
            id: 'role-growth',
            title: 'Head of Growth',
            origin: 'model',
            reason: 'запускали рост в двух компаниях',
            evidenceRefs: ['memory:2'],
            confirmation: { state: 'not-found' },
          },
        ],
        meta: { poolSize: 12 },
      }),
    });
  });
  // Задания «Какие роли мне подходят» тоже спрашиваются «Главной» (B180,
  // срез 3). Отвечаем пройденным прогоном: панель обязана напечатать числа со
  // знаменателями, а не сводный балл.
  await page.route('**/api/v1/candidate/work-preferences', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          keyVersion: 'work-preferences-pairs-v1',
          tasks: [
            {
              id: 'monday',
              prompt: 'Понедельник, девять утра. Что возьмёте первым?',
              options: [
                { id: 'monday-queue', text: 'Разобрать очередь из сорока заявок.', family: 'ПП' },
                { id: 'monday-why', text: 'Понять, почему заявок стало сорок.', family: 'НН' },
              ],
            },
          ],
          families: [
            { code: 'ПП', name: 'Порядок и поток', about: 'операции, логистика, процессы' },
            { code: 'НН', name: 'Неопределённость и направление', about: 'продукт, стратегия' },
          ],
          maxExcluded: 2,
          run: {
            keyVersion: 'work-preferences-pairs-v1',
            completedAt: '2026-09-03T09:00:00.000Z',
            result: {
              keyVersion: 'work-preferences-pairs-v1',
              answered: 12,
              counts: [
                {
                  family: 'ПП',
                  name: 'Порядок и поток',
                  value: 3,
                  total: 3,
                  basis: 'выбрали 3 раза из 3, когда это предлагалось',
                },
              ],
              excluded: [],
              discriminates: true,
              ranked: [
                {
                  family: 'ПП',
                  name: 'Порядок и поток',
                  value: 3,
                  total: 3,
                  basis: 'выбрали 3 раза из 3, когда это предлагалось',
                },
              ],
            },
          },
        },
        meta: {},
      }),
    });
  });
  // «Стратегия» спрашивается «Главной» отдельным маршрутом (B180, срез 2).
  // Без ответа прогон записал бы 502, который увидел бы и кандидат. Отвечаем
  // выбранной ролью со второй версией: панель обязана напечатать и причину
  // смены, и прежнее решение.
  await page.route('**/api/v1/candidate/strategy', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          current: {
            version: 2,
            role: {
              title: 'Продуктовый аналитик',
              origin: 'model',
              reason: 'вели продуктовую аналитику четыре года',
              evidenceRefs: ['memory:1'],
              confirmation: {
                state: 'observed',
                sampleSize: 12,
                observedFrom: '2026-08-20T08:00:00.000Z',
                observedTo: '2026-09-01T08:00:00.000Z',
              },
            },
            constraints: { regions: ['eu'], note: null },
            reason: 'откликов много, разговоров нет',
            decidedAt: '2026-09-03T09:00:00.000Z',
            provenance: {
              namedBy: 'gemini:gemini-3.6-flash',
              language: 'en',
              poolSize: 12,
            },
          },
          history: [
            {
              version: 1,
              role: {
                title: 'Head of Growth',
                origin: 'model',
                reason: null,
                evidenceRefs: [],
                confirmation: { state: 'not-found', sampleSize: 0 },
              },
              constraints: { regions: ['eu'], note: null },
              reason: 'Первый выбор роли',
              decidedAt: '2026-09-01T09:00:00.000Z',
              provenance: {
                namedBy: 'gemini:gemini-3.6-flash',
                language: 'en',
                poolSize: 10,
              },
            },
          ],
        },
        meta: {},
      }),
    });
  });
  // Resume Studio asks for the matched pool as soon as it opens; without an
  // answer the walk records a 502 the candidate would also see.
  // Пул, на котором «Вакансии» действительно проверяются: две записи из разных
  // источников, одна с зарплатой и одна без, с разным возрастом и разным
  // покрытием требований. Пустой ответ проверял только пустой экран.
  await page.route('**/api/v1/candidate/matched-vacancies*', async (route) => {
    const day = 86_400_000;
    const seen = (daysAgo) => new Date(Date.now() - daysAgo * day).toISOString();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            cluster: {
              id: 'cluster-fresh',
              canonicalTitle: 'Продуктовый аналитик',
              canonicalCompany: 'FinCloud',
              canonicalLocation: 'Москва',
              isRemote: true,
              salary: { from: 240000, to: 300000, currency: '₽', gross: true },
              descriptionSummary: '',
              skills: [],
              primaryUrl: 'https://example.test/vacancy/1',
              sources: [
                {
                  sourceType: 'hh',
                  sourceId: 'hh-1',
                  sourceUrl: 'https://example.test/vacancy/1',
                  observedAt: seen(2),
                },
              ],
              firstObservedAt: seen(2),
              lastSeenAt: seen(0),
              status: 'active',
              vacanciesCount: 1,
              companyFeatures: {
                relocation: true,
                currencyRemote: true,
                russianAbroad: false,
                fullRemote: true,
                industry: 'Fintech',
                atsProvider: 'greenhouse',
                city: 'Москва',
                coordinates: { lat: 55.7558, lng: 37.6173 },
              },
            },
            explanation: {
              clusterId: 'cluster-fresh',
              roleMatch: 'target',
              requirements: { matched: 3, total: 4 },
              matchingPoints: ['SQL', 'A/B-тесты', 'продуктовая аналитика'],
              missingPoints: ['Kubernetes'],
              summary: '',
              calculatedAt: seen(0),
            },
          },
          {
            cluster: {
              id: 'cluster-old',
              canonicalTitle: 'Product Analyst (Web3)',
              canonicalCompany: '',
              canonicalLocation: '',
              isRemote: true,
              salary: null,
              descriptionSummary: '',
              skills: [],
              primaryUrl: 'https://example.test/vacancy/2',
              sources: [
                {
                  sourceType: 'telegram',
                  sourceId: 'tg-1',
                  sourceUrl: 'https://example.test/vacancy/2',
                  observedAt: seen(19),
                },
              ],
              firstObservedAt: seen(19),
              lastSeenAt: seen(1),
              status: 'active',
              vacanciesCount: 1,
            },
            explanation: {
              clusterId: 'cluster-old',
              roleMatch: 'partial',
              requirements: { matched: 1, total: 3 },
              matchingPoints: ['SQL'],
              missingPoints: ['Solidity', 'Web3'],
              summary: '',
              calculatedAt: seen(0),
            },
          },
        ],
        // Подбор приходит страницами: экран читает `meta.nextOffset`, пока пул
        // не кончится (INC-029). Одна страница — весь стенд.
        meta: { total: 2, offset: 0, nextOffset: null },
      }),
    });
  });
  // Кампания «Поиска» читает подтверждённые команды кандидата: без ответа
  // прогон записал бы 502, который увидел бы и кандидат (B179).
  await page.route('**/api/v1/candidate/career-commands', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  // Ручные отклики (B165, срез 1): экран читает свою ручку, а подтверждение
  // уходит на неё же. Сервер атомарно создаёт карточку трекера при статусе
  // applied; стенд отражает тот же dual-write, чтобы экран видел карточку.
  page.__recordedApplications = [];
  const trackerCards = [];
  await page.route('**/api/v1/candidate/vacancy-applications', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}');
      page.__recordedApplications.push(body);
      const now = new Date().toISOString();
      if (
        body.status === 'applied' &&
        !trackerCards.some((application) => application.clusterId === body.clusterId)
      ) {
        trackerCards.push({
          id: `app-${trackerCards.length + 1}`,
          candidateId: 'candidate-1',
          clusterId: body.clusterId,
          stage: 'applied',
          closedReason: null,
          processProfile: 'standard',
          vacancy: {
            title: body.vacancy?.title ?? 'Продуктовый аналитик',
            company: body.vacancy?.company ?? 'FinCloud',
            companyHidden: false,
            url: body.vacancy?.url ?? 'https://example.test/vacancy/1',
            source: body.vacancy?.source ?? 'hh-1',
          },
          notes: null,
          followUpDueAt: null,
          stageChangedAt: now,
          version: 1,
          createdAt: now,
          updatedAt: now,
          followUp: null,
          whoseTurn: 'company',
          materials: { coverLetter: false, resume: false },
          nearestInterview: null,
        });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            clusterId: body.clusterId,
            status: body.status,
            vacancy: body.vacancy,
            openedAt: now,
            appliedAt: body.status === 'applied' ? now : null,
            confirmedBy: body.status === 'applied' ? 'candidate' : null,
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  // «Сегодня» (B251 S4b/S5): визит и снимок дня — TodayScreen читает эти
  // ручки напрямую, не через `useCareerCabinetData`.
  await page.route('**/api/v1/candidate/visits', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { since: '2026-08-13T08:00:00.000Z' } }),
    });
  });
  await page.route('**/api/v1/candidate/today*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          digest: {
            waitingForYou: 1,
            newVacancies: 2,
            closedVacancies: 0,
            interviewsAhead: 0,
            nextInterview: null,
            newVacanciesCaption: null,
            followUpCaptions: [],
          },
          queue: [
            {
              kind: 'new_vacancy',
              clusterId: 'cluster-fresh',
              title: 'Продуктовый аналитик',
              company: 'FinCloud',
              eyebrow: 'Новая вакансия',
              dueAt: null,
              fit: { role: 'target', level: 'target', geo: true },
            },
          ],
          followUps: [],
          sinceLastVisit: { since: '2026-08-13T08:00:00.000Z', items: [] },
          vacanciesPending: false,
        },
      }),
    });
  });
  // «Отклики» (B251 S3, C47): отклик из карточки вакансии создаёт карточку
  // трекера вместе со статусом отклика, доска читает его список (GET).
  await page.route('**/api/v1/candidate/applications*', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}');
      const now = new Date().toISOString();
      const card = {
        id: `app-${trackerCards.length + 1}`,
        candidateId: 'candidate-1',
        clusterId: body.clusterId ?? null,
        stage: body.stage ?? 'applied',
        closedReason: null,
        processProfile: 'standard',
        vacancy: {
          title: 'Продуктовый аналитик',
          company: 'FinCloud',
          companyHidden: false,
          url: 'https://example.test/vacancy/1',
          source: 'hh-1',
        },
        notes: null,
        followUpDueAt: null,
        stageChangedAt: now,
        version: 1,
        createdAt: now,
        updatedAt: now,
        followUp: null,
        whoseTurn: 'company',
        materials: { coverLetter: false, resume: false },
        nearestInterview: null,
      };
      trackerCards.push(card);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: card }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: trackerCards }),
    });
  });
  // C64: шапка Профиля читает согласие «Вы в поиске»; в гейте оно не дано.
  await page.route('**/api/v1/candidate/actions/usage*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          usage: {
            localDate: '2026-10-01',
            hhAppliesCount: 0,
            linkedinEasyAppliesCount: 0,
            hhBoostsCount: 0,
            lastHhBoostAt: null,
          },
          timezone: 'Europe/Moscow',
          resetAt: '2026-10-01T21:00:00.000Z',
          killSwitchActive: false,
          limits: {
            maxHhAppliesPerDay: 15,
            maxLinkedinEasyAppliesPerDay: 10,
            maxHhBoostsPerDay: 3,
            minHhBoostIntervalMinutes: 240,
          },
        },
      }),
    });
  });
  await page.route('**/api/v1/candidate/actions/receipts*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { receipts: [] } }),
    });
  });
  await page.route('**/api/v1/me/consents/actions_on_behalf', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { capability: 'actions_on_behalf', granted: false, consent: null },
      }),
    });
  });
  await page.route('**/api/v1/me/consents', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { consents: [] } }),
    });
  });
  await page.route('**/api/v1/candidate/search-consent', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { consent: { granted: false, policyVersion: '', updatedAt: '' } },
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
            searchCoverage:
              'Совпадения в общей выборке до 50 remote-вакансий; задержка источника до 24 часов',
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
            {
              kind: 'headline',
              value: 'Synthetic Product Lead',
              sourceLocator: 'public-meta:1',
              confidence: 'public-metadata',
            },
            {
              kind: 'summary',
              value: 'Builds evidence-led products.',
              sourceLocator: 'public-meta:2',
              confidence: 'public-metadata',
            },
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
      const connectionRemoved = hhDisconnectAttempts > 1;
      hhConnected = !connectionRemoved;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            platform: 'hh',
            status: 'disconnected',
            accessMode: 'native_session_snapshot',
            connectionRemoved,
            providerSession: 'not_managed',
            importedData: 'retained',
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
    name: 'Поиск работы с опорой на проверенные факты',
  });
  await landingHeading.waitFor({ state: 'visible', timeout: 2_000 });
  const shellMs = Math.round(performance.now() - startedAt);

  assert(
    (await page.locator('[data-bootstrap-shell="true"]').count()) === 1,
    `${viewport.name}: shared shell was not prerendered before JavaScript`,
  );
  // PRB-044: до гидратации ссылка «Войти» — обычная ссылка и ничем не накрыта.
  assert(
    (await page.locator('[data-bootstrap-shell="true"]').getAttribute('inert')) === null,
    `${viewport.name}: landing links are inert before hydration`,
  );
  assert(
    (await page
      .getByRole('heading', { name: 'Поиск работы с опорой на проверенные факты' })
      .count()) === 1,
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
    localStorage.setItem('candidate-workspace-owner', 'candidate-browser-test');
  });

  // Navigate to candidate workspace
  await page.goto(`${baseUrl}app?built-shell=${viewport.name}`);
  const shell = page.getByTestId('career-shell');
  await shell.waitFor({ state: 'visible', timeout: 10_000 });

  for (const label of ['Сегодня', 'Профиль', 'Вакансии', 'Отклики']) {
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
  // Since B148 §9 each section owns one subject; «Пульт» made «Главная» the
  // candidate himself — the dossier with the recommendation and the assessment
  // beside it — while the strategist dialogue stays in the «Эксперт» drawer and
  // the campaign stays in «Поиске» and the collected pool in «Вакансиях».
  await page.getByRole('heading', { name: 'Сегодня', exact: true }).first().waitFor();
  // B251 S5 / S10-VIS B — desktop Today uses the approved decisions, queue,
  // and funnel composition above 760 px; the 390 layout is the approved mobile Today.
  await page.locator('.career-today').first().waitFor();
  if (viewport.width > 760) {
    await page.locator('.career-today-desktop').waitFor({ state: 'visible' });
    for (const section of ['Следующее решение', 'Очередь дня', 'Воронка за 30 дней']) {
      await page.getByRole('region', { name: section }).waitFor();
    }
    assert(
      (await page.locator('.career-today-desktop .career-today-digest').count()) === 0,
      `${viewport.name}: legacy Today digest returned to the desktop layout`,
    );
  } else {
    await page.locator('.career-today-mobile').waitFor({ state: 'visible' });
  }
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({
    path: `output/playwright/b178-home-${viewport.name}.png`,
    fullPage: true,
  });

  // S10-VIS A2 — the consultant is docked and open on wide desktop layouts;
  // narrower layouts keep the existing explicit open action.
  // The panel is a complementary dock, a dialog overlay below 1280 px or a dialog sheet at 390 px.
  const expert = page.locator('.career-expert-panel');
  if (!(await expert.isVisible())) {
    await page
      .getByRole('button', { name: /^((Спросить|Открыть) консультанта|Консультант: открыть)$/ })
      .first()
      .click();
  }
  await expert.waitFor({ state: 'visible' });
  // Below 1280 px the panel starts as the 56 px strip; open it before the dialogue checks.
  const expand = expert.getByRole('button', { name: 'Развернуть консультанта' });
  if (await expand.isVisible()) await expand.click();
  await verifyCoachDelivery(page, expert, viewport);
  const dialogueContainment = await page.locator('.career-dialogue-history').evaluate((history) => {
    const boundary = history.closest('.career-expert-panel').getBoundingClientRect();
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
    `${viewport.name}: long dialogue text escaped the expert drawer ${JSON.stringify(dialogueContainment)}`,
  );
  if (viewport.width <= 760) {
    await expert
      .getByRole('button', { name: 'Развернуть или свернуть консультанта' })
      .last()
      .click();
    await expert.waitFor({ state: 'hidden' });
  } else {
    await expert.getByRole('button', { name: 'Свернуть консультанта в полосу' }).click();
    await page.locator('.career-expert-panel.consultant-strip').waitFor({ state: 'visible' });
  }

  // S10-VIS A3: desktop keeps the «Карьера» rail entry. Its route and filter
  // focus are exercised by the B366 end-to-end spec; the removed Today
  // stepper no longer acts as a second navigation trigger.
  if (viewport.width >= 1280) {
    await page
      .locator('aside#career-rail nav')
      .getByRole('button', { name: 'Карьера', exact: true })
      .waitFor({ state: 'visible' });
  }

  // «Вакансии» держат собранный пул (B248/B250): непустой пул рисует
  // `VacanciesScreen` (список + детальная карточка), а не старую
  // `VacancyBoard` (та осталась для загрузки/ошибки/пустого пула — ниже её
  // не проверяем, гейт всегда мокает непустой пул).
  await page.locator('button[aria-label="Вакансии"]:visible').click();
  await page.getByRole('heading', { name: 'Вакансии', exact: true }).waitFor();
  const vacancyRows = page.locator('.vac-list-item');
  assert(
    (await vacancyRows.count()) === 2,
    `${viewport.name}: пул вакансий не отрисовался (${await vacancyRows.count()})`,
  );
  // B250 identifies the feed row by its source and last observation date.
  // The approved screen does not make an age claim beside the row.
  // Строка подписывает дату по Москве (VacancyScreenRowCells): около полуночи UTC
  // часы раннера CI показывают другой день.
  const expectedHhDate = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(new Date(Date.now() - 2 * 86_400_000));
  await page
    .locator('.vac-sub')
    .filter({ hasText: `hh.ru, ${expectedHhDate}` })
    .first()
    .waitFor();
  // Фильтр «Свежесть» убран решением владельца (B250, п.4): в базе остаётся
  // только подпись «в базе N дн.» в строке; проверять нечего.
  await page.screenshot({
    path: `output/playwright/b178-vacancies-${viewport.name}.png`,
    fullPage: true,
  });

  // Отклик из карточки (B251 F5, C47, B341): «Откликнуться» ведёт на площадку,
  // запись «applied» ставит только подтверждение «Да, отклик отправлен».
  // На широком экране первая строка раскрыта сразу; на узком — свёрнута.
  const closeFilterSheet = page
    .locator('.vacancies-filters.is-expanded')
    .getByRole('button', { name: 'Свернуть', exact: true });
  if (await closeFilterSheet.isVisible()) await closeFilterSheet.click();
  const firstRowToggle = vacancyRows.first().locator('button[aria-expanded]').first();
  if ((await firstRowToggle.getAttribute('aria-expanded')) !== 'true') {
    await firstRowToggle.click();
  }
  await page.locator('.vacancies-detail-panel').waitFor();
  await page.getByRole('button', { name: 'Откликнуться' }).click();
  assert(
    page.__recordedApplications.length === 0,
    `${viewport.name}: отклик отмечен без подтверждения`,
  );
  await page.getByRole('button', { name: 'Да, отклик отправлен' }).click();
  const recorded = page.__recordedApplications;
  assert(
    recorded.length === 1 && recorded[0].status === 'applied' && Boolean(recorded[0].clusterId),
    `${viewport.name}: отклик из карточки не ушёл на сервер ${JSON.stringify(recorded)}`,
  );
  await page.screenshot({
    path: `output/playwright/b165-manual-application-${viewport.name}.png`,
    fullPage: true,
  });

  // B265 — «Профиль» is its own screen now (`ProfileScreenView`), not a fold
  // on «Сегодня»; «Документ и форматы» is a tab of that screen, not a route
  // into a separate Resume Studio page (that link is dead in the B248 IA).
  // Каталог подключений не грузится на старте; с C54 его читает шапка Профиля.
  assert(
    connectionCatalogRequests === 0,
    `${viewport.name}: connection catalog loaded before the candidate opened Profile`,
  );
  await page.locator('button[aria-label="Профиль"]:visible').click();
  // 390 has its own native Profile (mockup 2, iOS list) with the short tab «След».
  const mobileProfile = viewport.width <= 760;
  await page
    .locator(mobileProfile ? '.career-profile-mobile' : '.career-profile-screen-view')
    .first()
    .waitFor();
  // B441 — вкладки профиля: «Резюме», «Навыки», «Цифровой след»; блок
  // «Документ и форматы» ушёл из экрана вместе с меню документа.
  const profileTabs = page.getByRole('tablist', { name: 'Профиль' });
  await profileTabs.getByRole('tab', { name: 'Резюме' }).waitFor();
  await profileTabs
    .getByRole('tab', { name: mobileProfile ? 'След' : /^Цифровой след/u })
    .waitFor();
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: `output/playwright/resume-source-${viewport.name}.png` });
  await page.locator('button[aria-label="Сегодня"]:visible').click();
  await page.getByRole('heading', { name: 'Сегодня', exact: true }).waitFor();
  await page.locator('.career-today').first().waitFor();

  // «Отклики» (B251 S3, C47) — канбан, отдельный от «Вакансий»: отклик из
  // карточки выше обязан появиться здесь карточкой трекера, без тупика.
  await page.locator('button[aria-label="Отклики"]:visible').click();
  await page.getByRole('heading', { name: 'Отклики', exact: true }).waitFor();
  // B486: on narrow screens the list shows rows, not board cards.
  await (
    viewport.width <= 640
      ? page.getByRole('listitem').filter({ hasText: 'Продуктовый аналитик' })
      : page.locator('.career-responses-card', { hasText: 'Продуктовый аналитик' })
  )
    .first()
    .waitFor();

  // B486: the 390 «Отклики» header carries only the bell and the consultant,
  // so the tariffs and account entries are exercised from «Сегодня».
  await page.locator('button[aria-label="Сегодня"]:visible').click();
  await page.getByRole('heading', { name: 'Сегодня', exact: true }).waitFor();

  // B248: narrow screens keep the topbar's «Тарифы» link. Desktop opens it
  // from the connected Account billing tab.
  if (viewport.width <= 760) {
    await openFromShell(page, 'Тарифы');
  } else {
    await page.locator('button[aria-label="Открыть аккаунт"]:visible').first().click();
    const account = page.getByTestId('career-shell').getByRole('main');
    await account.getByRole('heading', { name: 'Аккаунт' }).waitFor();
    await account.getByRole('tab', { name: /Подписка и платежи/u }).click();
    await account.getByRole('button', { name: 'Сменить тариф' }).click();
  }
  if (viewport.width <= 640) {
    await page
      .locator('.career-tariffs-mobile .career-tariffs-title')
      .waitFor({ state: 'visible' });
  } else {
    await page.locator('#tariffs-page-title').waitFor({ state: 'visible' });
  }
  assert(
    (await page.locator('button[aria-label="Сегодня"]:visible').count()) === 1,
    `${viewport.name}: «Сегодня» disappeared after navigation`,
  );

  const catalogBeforeAccount = connectionCatalogRequests;
  await openFromShell(page, 'Аккаунт', 'button[aria-label="Открыть аккаунт"]:visible');
  const account = page.getByTestId('career-shell').getByRole('main');
  if (viewport.width <= 760) {
    await account.getByRole('heading', { name: 'Профиль и вход' }).waitFor();
    await account.getByRole('button', { name: 'Назад' }).click();
    await account.getByRole('button', { name: /Подключения/u }).click();
    await account.getByRole('heading', { name: 'Подключения' }).waitFor();
  } else {
    await account.getByRole('heading', { name: 'Аккаунт' }).waitFor();
    await account.getByRole('tab', { name: /Подключения/u }).click();
    await account.getByRole('heading', { name: 'Площадки и каналы' }).waitFor();
  }
  const hhConnectionEntry =
    viewport.width <= 760
      ? account.locator('.career-account-mobile-row').filter({ hasText: 'hh.ru' })
      : account.getByRole('button', { name: 'Управлять' });
  await hhConnectionEntry.waitFor();
  assert(
    connectionCatalogRequests === catalogBeforeAccount + 1,
    `${viewport.name}: account settings did not load one connection catalog`,
  );
  await openHhConnectionManagement(page, viewport);
  let hhDialog = page.getByRole('dialog', { name: 'hh.ru' });
  await hhDialog.getByRole('button', { name: 'Отключить' }).click();
  await page.getByText('Не удалось отключить hh.ru', { exact: false }).waitFor();
  await openHhConnectionManagement(page, viewport);
  hhDialog = page.getByRole('dialog', { name: 'hh.ru' });
  await hhDialog.getByRole('button', { name: 'Отключить' }).click();
  await page.getByText('hh.ru отключён', { exact: false }).waitFor();
  const logoutResponse = page.waitForResponse((res) => res.url().includes('/api/v1/auth/logout'));
  if (viewport.width <= 760) {
    await account.getByRole('button', { name: 'Назад' }).click();
    await account.getByRole('button', { name: 'Выйти из аккаунта' }).click();
  } else {
    await account.getByRole('tab', { name: 'Профиль и вход' }).click();
    await account.getByRole('button', { name: 'Выйти из аккаунта' }).click();
  }
  const signOutDialog = page.getByRole('alertdialog', { name: 'Выйти из аккаунта?' });
  await signOutDialog.getByRole('button', { name: 'Выйти из аккаунта' }).click();
  await logoutResponse;
  await page.getByRole('heading', { name: 'Поиск работы с опорой на проверенные факты' }).waitFor();
  assert(
    (await page.locator('.career-account-container').count()) === 0,
    `${viewport.name}: account screen remained open after logout`,
  );
  assert(
    (await page.evaluate(() => localStorage.getItem('candidate-workspace'))) === null,
    `${viewport.name}: logout retained candidate workspace`,
  );
  await page.goto(`${baseUrl}app?built-shell=${viewport.name}`);
  await page.getByRole('heading', { name: 'Поиск работы с опорой на проверенные факты' }).waitFor();
  const accountRestart =
    (await page.evaluate(() => localStorage.getItem('candidate-workspace'))) === null;
  assert(accountRestart, `${viewport.name}: logout retained the candidate workspace`);

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
  };
}

async function verifyExpiredSessionRestore(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  // Everything the fixture does not know answers an empty success, so the account
  // page that stays open after sign-in does not fall into its error card.
  await page.route('**/api/v1/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: null }),
    });
  });
  let authenticated = false;
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/auth'),
    async (route) => {
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
    },
  );
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
  // The candidate workspace is server-owned; this fixture returns the saved record.
  await page.route('**/api/v1/candidate/workspace', async (route) => {
    const request = route.request();
    if (request.method() === 'PUT') {
      const body = JSON.parse(request.postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: body.workspace ?? null }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: null }),
    });
  });
  await page.route('**/api/v1/candidate/me/messages*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], meta: { total: 0, offset: 0, nextOffset: null } }),
    });
  });
  await page.route('**/api/v1/candidate/me*', async (route) => {
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
          messages: [],
          memory: [],
          turns: [],
          assessments: [],
          documents: [],
          germanyMarket: null,
          vacancySubscriptions: [],
          dossier: {
            sections: [],
            confirmedCount: 0,
            proposedCount: 0,
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
    localStorage.setItem('candidate-workspace-owner', 'candidate-expired-session');
  });
  await page.goto(`${baseUrl}app`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Открыть аккаунт' }).waitFor();
  await page.getByRole('button', { name: 'Открыть аккаунт' }).click();
  const accountAccess = page.locator('.career-account-access');
  await accountAccess.getByRole('heading', { name: 'Аккаунт' }).waitFor();
  await accountAccess.getByLabel('Email или логин').fill('returning.candidate');
  await accountAccess.getByLabel('Пароль', { exact: true }).fill('returning-candidate-password');
  await accountAccess.getByRole('button', { name: 'Войти в кабинет' }).click();
  // Sign-in from the account page keeps the account open; the cabinet is one click away.
  await page.getByRole('main').getByRole('heading', { name: 'Аккаунт' }).first().waitFor();
  const matchingOwnerRestored =
    (await page.evaluate(() => localStorage.getItem('candidate-workspace'))) !== null;
  assert(
    matchingOwnerRestored,
    'expired session: matching candidate workspace was deleted during login',
  );
  await context.close();
  return { matchingOwnerRestored };
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
