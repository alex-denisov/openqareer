import { expect, test, type Page } from '@playwright/test';
import { captureCareerHarness } from './helpers/capture-career-harness';

/**
 * B250 — верх экрана «Вакансии» (баннер роли/гипотез, уровень, фильтры) и
 * список пула из макета B248. Проверяет, что новый экран действительно
 * подключён (а не старая доска VacancyBoard) и не переполняет вьюпорт.
 */

const CANDIDATE = {
  username: 'vacancies.candidate',
  email: 'vacancies.candidate@example.com',
  displayName: 'Кандидат Вакансий',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-b250',
};

const ACCOUNT = {
  username: CANDIDATE.username,
  email: CANDIDATE.email,
  displayName: CANDIDATE.displayName,
  profile: {
    headline: 'VP Technology Operations',
    location: 'Дубай',
    workMode: 'hybrid' as const,
    updatedAt: '2026-09-01T12:00:00.000Z',
  },
  sessions: [],
};

const SNAPSHOT = {
  candidate: {
    id: CANDIDATE.candidateId,
    dataClass: 'synthetic',
    locale: 'ru-RU',
    createdAt: '2026-09-01T12:00:00.000Z',
  },
  messages: [],
  memory: [],
  turns: [],
  dossier: {
    sections: [],
    confirmedCount: 3,
    proposedCount: 0,
    readiness: { complete: true, unresolvedQuestions: 0, checks: [] },
  },
  documents: [],
  assessments: [],
  germanyMarket: null,
  vacancySubscriptions: [],
};

const CAMPAIGN = {
  roles: { value: ['Enterprise Architect'], origin: 'profile' },
  regions: { value: ['United States', 'Philippines', 'Германия'], origin: 'profile' },
  suggestedRegions: ['mena'],
  remoteOnly: false,
  autoRoles: [
    { id: 'architect.primary', title: 'Enterprise Architect', kind: 'primary' as const },
    { id: 'architect.cloud', title: 'Cloud Architect', kind: 'adjacent' as const },
  ],
  roleHypotheses: [
    { role: 'Enterprise Architect', vacancyCount: 34, isHypothesis: false },
    { role: 'Cloud Architect', vacancyCount: 6, isHypothesis: true },
    { role: 'Solutions Architect', vacancyCount: 3, isHypothesis: true },
  ],
};

function cluster(
  id: string,
  title: string,
  company: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id,
    canonicalTitle: title,
    canonicalCompany: company,
    canonicalLocation: 'Дубай',
    isRemote: false,
    salary: { from: 170000, to: 210000, currency: 'USD', gross: true },
    descriptionSummary: '',
    skills: ['Operations', 'P&L', 'Стратегия'],
    primaryUrl: 'https://example.com/vacancy',
    sources: [
      {
        sourceType: 'hh',
        sourceId: id,
        sourceName: 'hh.ru',
        sourceUrl: 'https://hh.ru/vacancy',
        observedAt: '2026-09-20T08:00:00.000Z',
      },
    ],
    firstObservedAt: '2026-09-20T08:00:00.000Z',
    lastSeenAt: '2026-09-23T08:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
    ...overrides,
  };
}

function explanation(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    clusterId: id,
    roleMatch: 'target',
    levelMatch: 'match',
    outsideGeography: false,
    matchingPoints: ['Опыт управления P&L', 'Международная команда'],
    missingPoints: [],
    summary: '',
    calculatedAt: '2026-09-24T08:00:00.000Z',
    ...overrides,
  };
}

const MATCHED_ITEMS = [
  {
    cluster: cluster('c-1', 'Business Information Architect', 'Genetec', {
      canonicalLocation: 'Канада',
      isRemote: true,
      salary: { from: 190000, to: 240000, currency: 'USD', gross: true },
    }),
    explanation: explanation('c-1'),
  },
  {
    cluster: cluster('c-2', 'Enterprise Architect, Senior', 'Peraton', {
      canonicalLocation: 'United States',
      salary: { from: 180000, currency: 'USD', gross: true },
    }),
    explanation: explanation('c-2', {
      levelMatch: 'below',
      missingPoints: ['Опыт работы с госзаказчиками'],
    }),
  },
  {
    cluster: cluster('c-3', 'Cloud & Infrastructure Architect', 'Sonsoft Inc', {
      canonicalLocation: 'United States',
      salary: { to: 220000, currency: 'USD', gross: true },
    }),
    explanation: explanation('c-3', { levelMatch: 'unknown' }),
  },
  {
    cluster: cluster('c-4', 'Enterprise Architect Director', 'HRTx, Inc.', {
      canonicalLocation: 'Philippines',
      salary: null,
    }),
    explanation: explanation('c-4', { outsideGeography: true }),
  },
  {
    cluster: cluster('c-5', 'Enterprise Solutions Architect', 'Acme Corp', {
      canonicalLocation: 'Германия',
    }),
    explanation: explanation('c-5'),
  },
  {
    cluster: cluster(
      'c-6',
      'Principal Enterprise Architect for Global Platform Modernization Program',
      'A Very Long Company Name For Overflow Testing LLC',
      { canonicalLocation: 'Германия, удалённо', isRemote: true },
    ),
    explanation: explanation('c-6'),
  },
];

interface VacancyStubScenario {
  readonly matchedItems?: typeof MATCHED_ITEMS;
  readonly total?: number;
  readonly facets?: typeof FACETS;
  readonly campaign?: typeof CAMPAIGN;
  readonly failMatched?: boolean;
  readonly delayMatchedMs?: number;
  readonly campaignUpdates?: unknown[];
  readonly matchedReadCount?: { value: number };
}

async function stubSession(page: Page, scenario: VacancyStubScenario = {}): Promise<void> {
  let currentCampaign = scenario.campaign ?? CAMPAIGN;
  let matchedReads = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
    if (pathname === '/api/v1/candidate/me') return route.fulfill({ json: { data: SNAPSHOT } });
    if (pathname === '/api/v1/account') return route.fulfill({ json: { data: ACCOUNT } });
    if (pathname === '/api/v1/candidate/connections') return route.fulfill({ json: { data: [] } });
    if (pathname === '/api/v1/candidate/workspace') {
      return route.fulfill({ json: { data: null } });
    }
    if (pathname === '/api/v1/candidate/vacancy-sources') {
      return route.fulfill({
        json: {
          data: [
            { id: 'hh', name: 'hh.ru', health: { status: 'healthy' } },
            { id: 'remotive', name: 'Remotive', health: { status: 'unavailable' } },
          ],
        },
      });
    }
    if (request.method() === 'POST' && pathname === '/api/v1/candidate/campaign') {
      const update = request.postDataJSON() as {
        roles: Array<string | { id: string; title: string }>;
        regions: string[];
        remoteOnly?: boolean;
      };
      scenario.campaignUpdates?.push(update);
      const roles = update.roles.map((role) => (typeof role === 'string' ? role : role.title));
      currentCampaign = {
        ...currentCampaign,
        roles: { value: roles, origin: 'explicit' },
        regions: { value: update.regions, origin: 'explicit' },
        remoteOnly: update.remoteOnly ?? false,
        roleHypotheses: roles.map((role) => ({ role, vacancyCount: 0, isHypothesis: true })),
      };
      return route.fulfill({ json: { data: currentCampaign } });
    }
    if (pathname === '/api/v1/candidate/matched-vacancies') {
      matchedReads += 1;
      if (scenario.matchedReadCount) scenario.matchedReadCount.value = matchedReads;
      if (scenario.delayMatchedMs) {
        await new Promise((resolve) => setTimeout(resolve, scenario.delayMatchedMs));
      }
      if (scenario.failMatched) {
        return route.fulfill({
          status: 503,
          json: { error: { code: 'source_unavailable', message: 'Подбор не ответил.' } },
        });
      }
      return route.fulfill({
        json: {
          data: scenario.matchedItems ?? MATCHED_ITEMS,
          meta: {
            total: scenario.total ?? 61,
            nextOffset: null,
            campaign: currentCampaign,
            candidateLevel: 'VP / C-level',
            facets:
              scenario.facets ??
              (scenario.matchedItems?.length === 0
                ? { total: 0, regions: [], remote: 0, levels: [], roles: [], sources: [] }
                : FACETS),
          },
        },
      });
    }
    if (pathname === '/api/v1/candidate/search-consent') {
      return route.fulfill({
        json: { consent: { granted: true, grantedAt: '2026-09-20T08:00:00.000Z' } },
      });
    }
    if (pathname.includes('/enrich-contacts') || pathname.endsWith('/contacts')) {
      return route.fulfill({
        json: {
          data: {
            contacts: [
              {
                id: 'c-recruiter-1',
                vacancyId: 'c-1',
                companyName: 'Genetec',
                fullName: 'Елена Смирнова',
                roleTitle: 'Technical Recruiter',
                email: 'elena.smirnova@genetec.com',
                emailStatus: 'verified',
                phone: '+1 514 555-0199',
                telegram: '@elena_genetec',
                whatsapp: null,
                linkedinUrl: 'https://linkedin.com/in/elena-smirnova',
                githubUrl: null,
                twitterUrl: null,
                sourceType: 'domain_osint',
                confidence: 0.95,
                createdAt: '2026-09-20T08:00:00.000Z',
                updatedAt: '2026-09-20T08:00:00.000Z',
              },
            ],
            job: {
              id: 'job-1',
              vacancyId: 'c-1',
              status: 'ready',
              createdAt: '2026-09-20T08:00:00.000Z',
            },
          },
        },
      });
    }
    if (pathname.endsWith('/pitch')) {
      return route.fulfill({
        json: {
          data: {
            vacancyId: 'c-1',
            emailPitch: { subject: 'Отклик', body: 'Текст письма' },
            linkedInNote: 'Заметка для LinkedIn',
            atsCoverLetter: 'ATS сопроводительное письмо',
            contactMessage:
              'Здравствуйте, Елена Смирнова! Меня зовут Алексей Денисов, откликаюсь на позицию Business Information Architect в Genetec. Коротко о моём опыте: сократил время закрытия вакансий на 30%. Буду рад короткому звонку, чтобы обсудить задачи роли и взаимные ожидания.',
            usedEvidenceIds: ['evidence-1'],
            language: 'ru',
            generatedAt: '2026-09-28T09:00:00.000Z',
          },
        },
      });
    }
    if (pathname.endsWith('/detail')) {
      return route.fulfill({
        json: {
          data: {
            id: 'c-1',
            description: 'Полное описание вакансии Business Information Architect в Genetec.',
            truncated: false,
            skills: ['Operations', 'P&L', 'Стратегия'],
            responsibilities: ['Управление архитектурой', 'Стратегическое планирование'],
          },
        },
      });
    }
    return route.fulfill({ json: { data: null } });
  });
}

// Профиль и роль подтверждены (3+ evidence, роль с fitState 'plausible' и
// свежая выборка рынка), чтобы «Подборка» — а не «Профиль» — была текущим
// шагом индикатора пути, когда пул вакансий уже не пуст (приёмка B250).
const CONFIRMED_EVIDENCE_ITEMS = [
  {
    id: 'evidence-1',
    kind: 'result' as const,
    sourceExcerpt: 'Сократил время закрытия вакансий на 30%',
    statement: 'Сократил время закрытия вакансий на 30%',
    status: 'confirmed' as const,
    userEdited: false,
  },
  {
    id: 'evidence-2',
    kind: 'scope' as const,
    sourceExcerpt: 'Руководил командой архитекторов из 12 человек',
    statement: 'Руководил командой архитекторов из 12 человек',
    status: 'confirmed' as const,
    userEdited: false,
  },
  {
    id: 'evidence-3',
    kind: 'scope' as const,
    sourceExcerpt: 'Отвечал за архитектуру платформы в 3 регионах',
    statement: 'Отвечал за архитектуру платформы в 3 регионах',
    status: 'confirmed' as const,
    userEdited: false,
  },
];

async function seedWorkspace(page: Page): Promise<void> {
  await page.addInitScript(
    ({ storageKey, ownerKey, candidateId, workspace }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(workspace));
      window.localStorage.setItem(ownerKey, candidateId);
    },
    {
      storageKey: 'candidate-workspace',
      ownerKey: 'candidate-workspace-owner',
      candidateId: CANDIDATE.candidateId,
      workspace: {
        version: 7,
        createdAt: '2026-09-01T12:00:00.000Z',
        updatedAt: '2026-09-01T12:00:00.000Z',
        resumeText:
          'VP Technology Operations with 15+ years scaling platform and operations organisations.',
        resumeSource: 'text',
        targetDirection: 'VP Technology Ops',
        regions: ['mena', 'eu'],
        currentSituation: 'Ищу VP-роль в операциях технологической компании.',
        constraints: 'Hybrid',
        urgency: 'active',
        outcomes: [],
        analysis: {
          evidenceMethodVersion: 'evidence-local-v1',
          roleMethodVersion: 'role-hypotheses-local-v1',
          evidenceItems: CONFIRMED_EVIDENCE_ITEMS,
          questions: [],
          roleHypotheses: [
            {
              id: 'role-enterprise-architect',
              title: 'Enterprise Architect',
              fitState: 'plausible',
              basis: 'Опыт архитектуры платформы и управления командой',
              evidenceIds: ['evidence-1', 'evidence-2', 'evidence-3'],
              gaps: [],
            },
          ],
        },
        marketSample: {
          source: 'hh',
          query: 'Enterprise Architect',
          found: 61,
          fetchedAt: '2026-09-20T08:00:00.000Z',
          items: Array.from({ length: 5 }, (_, index) => ({
            id: `market-${index + 1}`,
            title: 'Enterprise Architect',
            company: `Компания ${index + 1}`,
            location: 'Дубай',
            sourceUrl: `https://hh.ru/vacancy/${100000 + index}`,
            publishedAt: null,
            salary: null,
          })),
        },
      },
    },
  );
}

async function openVacancies(page: Page): Promise<void> {
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await page.locator('button[aria-label="Вакансии"]:visible').first().click();
  await expect(page.locator('.vacancies-screen')).toBeVisible();
}

// B338-2: сводка подборки, из которой строятся фильтры.
const FACETS = {
  total: 61,
  regions: [
    { id: 'us', count: 40 },
    { id: 'mena', count: 3 },
  ],
  remote: 12,
  levels: [
    { level: 'vp', count: 30 },
    { level: 'unknown', count: 8 },
  ],
  roles: [
    { role: 'Enterprise Architect', count: 34 },
    { role: 'Cloud Architect', count: 6 },
  ],
  sources: [{ sourceId: 'indeed', name: 'Indeed', count: 61 }],
};

test.describe('B250 vacancies screen', () => {
  test('shows the campaign banner, filters from the pool summary and pool rows', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    await expect(page.locator('.vacancies-screen h1')).toHaveText('Вакансии');
    await expect(page.locator('.career-page-header-kicker')).toContainText('Enterprise Architect');

    const filterToggle = page.locator('.vacancies-mobile-filter-toggle');
    if (!(await page.locator('.filters-panel.is-expanded').isVisible())) {
      await filterToggle.click();
    }
    const filters = page.locator('.vacancies-filters');
    // B338-2: каждое значение — из сводки подборки, с числом; предустановленных нет.
    await expect(filters.getByRole('button', { name: 'Enterprise Architect · 34' })).toBeVisible();
    await expect(filters.getByRole('button', { name: 'Cloud Architect · 6' })).toBeVisible();
    await expect(filters.getByRole('button', { name: 'VP · 30' })).toBeVisible();
    await expect(filters.getByRole('button', { name: 'Удалённо · 12' })).toBeVisible();
    await expect(filters.getByRole('button', { name: 'Indeed · 61' })).toBeVisible();
    await expect(filters.getByText(/Добавить:/)).toHaveCount(0);

    const rows = page.locator('.vac-list-item');
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toContainText('Business Information Architect');
    await expect(rows.first()).toContainText('Genetec');
  });

  test('the screen fits 1440, 390 and 320 with no horizontal overflow', async ({
    page,
  }, testInfo) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const wideOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(wideOverflow).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: 'output/playwright/C74/vacancies-1440.png',
      fullPage: true,
    });
    await page.screenshot({
      path: process.env.SHOTS_DIR
        ? `${process.env.SHOTS_DIR}/vacancies-1440.png`
        : testInfo.outputPath('vacancies-1440.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.vacancies-screen')).toBeVisible();

    // C74: filters collapsed by default on <= 480px into single line with active count
    const filterToggle = page.locator('.vacancies-mobile-filter-toggle');
    await expect(filterToggle).toBeVisible();
    await expect(filterToggle).toContainText(/Фильтры\s*·\s*\d+\s*активн/);
    await expect(filterToggle).toHaveAttribute('aria-expanded', 'false');

    // C74: first row of vacancies list is visible without scrolling on 390
    const firstRow = page.locator('.vac-list-item').first();
    await expect(firstRow).toBeVisible();
    const firstRowBox = await firstRow.boundingBox();
    expect(firstRowBox).not.toBeNull();
    expect(firstRowBox!.y).toBeLessThan(844);

    const narrowOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(narrowOverflow).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 320, height: 844 });
    const compactOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(compactOverflow).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: 'output/playwright/C74/vacancies-390.png',
      fullPage: false,
    });
    await page.screenshot({
      path: process.env.SHOTS_DIR
        ? `${process.env.SHOTS_DIR}/vacancies-390.png`
        : testInfo.outputPath('vacancies-390.png'),
      fullPage: true,
    });

    void testInfo;
  });

  test('expands row accordion on 1440 with five actions and recruiter info', async ({ page }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const firstItem = page.locator('.vac-list-item').first();
    const row = firstItem.locator('.vac-row');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Business Information Architect');
    await expect(row).toContainText('Genetec');

    if ((await row.getAttribute('aria-expanded')) !== 'true') {
      await row.click();
    }
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(row).toHaveClass(/is-selected/);

    const detail = firstItem.locator('.vac-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Требования вакансии');

    const actions = detail.locator('.vacancies-detail-actions');
    await expect(actions.getByRole('button', { name: 'Откликнуться' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Я уже откликнулся' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Нетворкинг' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Подробнее' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Сопроводительное письмо' })).toBeVisible();
  });

  test('clicking the header of the expanded vacancy collapses it and opens no other one', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const expanded = page.locator('.vac-row[aria-expanded="true"]');
    const second = page.locator('.vac-list-item').nth(1).locator('.vac-row');
    await second.click();
    await expect(second).toHaveAttribute('aria-expanded', 'true');
    await expect(expanded).toHaveCount(1);

    await second.click();
    await expect(second).toHaveAttribute('aria-expanded', 'false');
    // Collapsing must not hand the selection back to the default vacancy.
    await expect(expanded).toHaveCount(0);
  });

  test('on 390 selecting a row expands the accordion and clicking again collapses it', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const firstItem = page.locator('.vac-list-item').first();
    const row = firstItem.locator('.vac-row');
    const detail = firstItem.locator('.vac-detail');

    if ((await row.getAttribute('aria-expanded')) === 'true') {
      await row.click();
    }
    await expect(detail).not.toBeVisible();
    await expect(row).toHaveAttribute('aria-expanded', 'false');

    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(detail).toBeVisible();

    // C74: actions and recruiter block are visible on 390 in the top section
    await expect(detail.locator('.vacancies-detail-actions')).toBeVisible();
    await expect(detail.locator('.vacancies-recruiter-block')).toBeVisible();
    await page.screenshot({
      path: 'output/playwright/C74/vacancy-detail-390.png',
      fullPage: false,
    });

    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(detail).not.toBeVisible();
  });

  test('the path indicator shows exactly one current step, and it is «Подборка»', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    await expect(page.locator('.career-path-step')).toHaveCount(5);
    const active = page.locator('.career-path-step[data-state="active"]');
    await expect(active).toHaveCount(1);
    await expect(active).toContainText('Подборка');
    // Профиль и Роль уже подтверждены — пул непуст, поэтому предыдущие шаги
    // пути не могут остаться «текущими» (приёмка B250).
    await expect(page.locator('.career-path-step').nth(0)).toHaveAttribute('data-state', 'done');
    await expect(page.locator('.career-path-step').nth(1)).toHaveAttribute('data-state', 'done');
  });

  test('shows the «Откликнуться» button on 1440 and inside the mobile panel on 390', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const firstItem = page.locator('.vac-list-item').first();
    if ((await firstItem.locator('.vac-row').getAttribute('aria-expanded')) !== 'true') {
      await firstItem.locator('.vac-row').click();
    }
    const applyButton = firstItem.locator('.vac-detail').getByRole('button', {
      name: 'Откликнуться',
    });
    await expect(applyButton).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(applyButton).toBeVisible();
  });

  test('«Нетворкинг» открывает контакты компании и ничего не отправляет (B297)', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const firstItem = page.locator('.vac-list-item').first();
    if ((await firstItem.locator('.vac-row').getAttribute('aria-expanded')) !== 'true') {
      await firstItem.locator('.vac-row').click();
    }

    const networking = firstItem.locator('.vac-detail').getByRole('button', { name: 'Нетворкинг' });
    await expect(networking).toBeVisible();
    await networking.click();

    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();
    // Контактов у тестовой учётной записи нет, и продукт говорит об этом прямо,
    // а не рисует пустой список с вкладками «(0)» (B297).
    await expect(dialog.getByText('В этой компании мы никого не знаем')).toBeVisible();
    await expect(dialog.getByRole('tablist', { name: 'Категории контактов' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /Скопировать/u })).toBeVisible();
  });

  test('low role coverage exposes explicit campaign changes', async ({ page }, testInfo) => {
    const updates: unknown[] = [];
    const lowCampaign = {
      ...CAMPAIGN,
      regions: { value: ['United States', 'Philippines', 'Германия'], origin: 'explicit' as const },
      roleHypotheses: [{ role: 'Enterprise Architect', vacancyCount: 5, isHypothesis: true }],
    };
    await stubSession(page, {
      campaign: lowCampaign,
      matchedItems: MATCHED_ITEMS.slice(0, 5),
      total: 5,
      campaignUpdates: updates,
    });
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const banner = page.locator('.vacancy-hypothesis-banner');
    await expect(banner).toContainText('Это гипотеза, не результат.');
    await expect(banner).toContainText('По роли Enterprise Architect найдено 5 вакансий');
    if (testInfo.project.name === 'mobile-390') {
      const filterToggle = page.getByRole('button', {
        name: 'Фильтры и сохранённые запросы',
      });
      await expect(filterToggle).toHaveAttribute('aria-expanded', 'false');
      const firstRow = page.locator('.vac-list-item').first();
      await expect(firstRow).toBeVisible();
      const firstRowBottom = await firstRow.evaluate(
        (element) => element.getBoundingClientRect().bottom,
      );
      const bottomNavTop = await page
        .locator('.career-mobile-nav')
        .evaluate((element) => element.getBoundingClientRect().top);
      expect(firstRowBottom).toBeLessThan(bottomNavTop);
    }
    await captureCareerHarness(page, testInfo.outputPath('vacancies-hypothesis.html'));
    await page.screenshot({
      path: testInfo.outputPath('vacancies-hypothesis.png'),
      fullPage: true,
    });

    await banner.getByRole('button', { name: /Добавить роль/ }).click();
    await expect.poll(() => updates.length).toBe(1);
    expect(
      (updates[0] as { roles: Array<string | { id: string; title: string }> }).roles,
    ).toContainEqual({ id: 'architect.cloud', title: 'Cloud Architect' });

    await banner.getByRole('button', { name: 'Расширить географию' }).click();
    await banner.getByRole('button', { name: 'Добавить EU' }).click();
    await expect.poll(() => updates.length).toBe(2);
    expect((updates[1] as { regions: string[] }).regions).toContain('eu');

    // «Только удалённо» сужает выдачу, поэтому баннер его не предлагает — только снимает.
    await expect(banner.getByRole('button', { name: /Удалённо/ })).toHaveCount(0);
    expect(updates).toHaveLength(2);
  });

  test('geo filter offers only regions present in the pool, never suggestions (C63, B338-2)', async ({
    page,
  }) => {
    await stubSession(page, { campaign: { ...CAMPAIGN, suggestedRegions: ['mena'] } });
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    await expect(
      page
        .locator('.vacancy-hypothesis-banner')
        .getByRole('button', { name: 'Расширить географию' }),
    ).toHaveCount(0);
    const filterToggle = page.locator('.vacancies-mobile-filter-toggle');
    if (!(await page.locator('.filters-panel.is-expanded').isVisible())) {
      await filterToggle.click();
    }
    const filters = page.locator('.vacancies-filters');
    await expect(filters.getByRole('button', { name: 'Добавить: MENA' })).toHaveCount(0);
    const mena = filters.getByRole('button', { name: /MENA · 3/ });
    await expect(mena).toBeVisible();
    await expect(mena).toHaveAttribute('aria-pressed', 'false');
  });

  test('shows a zero-result hypothesis and names a source when loading fails', async ({
    page,
  }, testInfo) => {
    await stubSession(page, {
      matchedItems: [],
      total: 0,
      campaign: {
        ...CAMPAIGN,
        roleHypotheses: [{ role: 'Enterprise Architect', vacancyCount: 0, isHypothesis: true }],
      },
    });
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);
    await expect(page.locator('.vacancies-state')).toContainText(
      'По роли Enterprise Architect пока нет вакансий',
    );
    await expect(page.locator('.vacancy-hypothesis-banner')).toContainText(
      'По роли Enterprise Architect найдено 0 вакансий',
    );
    await page.screenshot({ path: testInfo.outputPath('vacancies-empty.png'), fullPage: true });

    const errorPage = await page.context().newPage();
    const matchedReadCount = { value: 0 };
    await stubSession(errorPage, { failMatched: true, matchedReadCount });
    await seedWorkspace(errorPage);
    await errorPage.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(errorPage);
    await expect(errorPage.locator('.vacancies-state.is-error')).toContainText('Remotive');
    const retry = errorPage.getByRole('button', { name: 'Повторить' });
    await expect(retry).toBeVisible();
    await errorPage.screenshot({
      path: testInfo.outputPath('vacancies-error.png'),
      fullPage: true,
    });
    await retry.click();
    await expect.poll(() => matchedReadCount.value).toBeGreaterThan(1);
    await errorPage.close();
  });

  test('C72: found recruiter card has «Написать» action opening message panel with copy and channel buttons', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const firstItem = page.locator('.vac-list-item').first();
    if ((await firstItem.locator('.vac-row').getAttribute('aria-expanded')) !== 'true') {
      await firstItem.locator('.vac-row').click();
    }

    const detail = firstItem.locator('.vac-detail');
    await expect(detail).toBeVisible();

    const recruiterBtn = detail.locator('.career-recruiter-btn');
    await expect(recruiterBtn).toBeVisible();
    await recruiterBtn.click();

    const recruiterCard = detail.locator('.career-recruiter-card');
    await expect(recruiterCard).toBeVisible();
    await expect(recruiterCard).toContainText('Елена Смирнова');

    const writeBtn = recruiterCard.locator('.career-recruiter-write-btn');
    await expect(writeBtn).toBeVisible();
    await writeBtn.click();

    const msgPanel = recruiterCard.locator('.career-recruiter-message-panel');
    await expect(msgPanel).toBeVisible();
    await expect(msgPanel).toContainText('Елена Смирнова');
    await expect(msgPanel.locator('.career-recruiter-message-copy-btn')).toBeVisible();

    await page.screenshot({
      path: 'output/playwright/C72/recruiter-message-1440.png',
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(msgPanel).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await msgPanel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: 'output/playwright/C72/recruiter-message-390.png',
      fullPage: false,
    });
  });

  test('marks phantom, stale and suspicious vacancies, moves them down with reason displayed (B262)', async ({
    page,
  }, testInfo) => {
    const isMobile = testInfo.project.name === 'mobile-390';
    const vpSuffix = isMobile ? '390' : '1440';

    const freshItem = {
      cluster: cluster('c-fresh', 'Enterprise Architect', 'Fresh Tech Corp', {
        firstObservedAt: '2026-09-25T10:00:00.000Z',
        canonicalLocation: 'United States',
        isRemote: true,
      }),
      explanation: explanation('c-fresh', {
        matchingPoints: ['System Architecture'],
      }),
    };

    const staleItem = {
      cluster: cluster('c-stale', 'Enterprise Architect', 'Legacy Systems Inc', {
        firstObservedAt: '2026-07-01T10:00:00.000Z', // > 60 days
        canonicalLocation: 'United States',
        isRemote: true,
      }),
      explanation: explanation('c-stale', {
        matchingPoints: ['System Architecture'],
      }),
    };

    const deadItem = {
      cluster: cluster('c-dead', 'Enterprise Architect', 'Ghost Corp', {
        firstObservedAt: '2026-09-25T10:00:00.000Z',
        canonicalLocation: 'United States',
        isRemote: true,
        deadLink: true,
      }),
      explanation: explanation('c-dead', {
        matchingPoints: ['System Architecture'],
      }),
    };

    // Порядок задаёт сервер (C71: экран и API — один порядок); заглушка отдаёт
    // его так, как отсортировал бы сервер. Сам порядок — в vacancyMatchOrder.test.ts.
    await stubSession(page, {
      matchedItems: [freshItem, staleItem, deadItem],
      total: 3,
    });
    await seedWorkspace(page);

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    await expect(page.locator('.vacancies-screen h1')).toHaveText('Вакансии');

    const rows = page.locator('.vac-row');
    await expect(rows).toHaveCount(3);

    // 1. Fresh item should be sorted to first position
    const row0 = rows.nth(0);
    await expect(row0).toContainText('Fresh Tech Corp');
    await expect(row0.locator('.vac-trust-line')).toHaveCount(0);

    // 2. Stale item should be sorted to second position with single line reason
    const row1 = rows.nth(1);
    await expect(row1).toContainText('Legacy Systems Inc');
    const staleTrustLine = row1.locator('.vac-trust-line.is-stale');
    await expect(staleTrustLine).toBeVisible();
    await expect(staleTrustLine).toContainText('Вакансия открыта более 60 дней');

    // 3. Dead link item should be sorted to third (bottom) position with single line reason
    const row2 = rows.nth(2);
    await expect(row2).toContainText('Ghost Corp');
    const deadTrustLine = row2.locator('.vac-trust-line.is-suspicious');
    await expect(deadTrustLine).toBeVisible();
    await expect(deadTrustLine).toContainText('Ссылка на вакансию недоступна');

    // 4. Click stale item and verify detail panel trust alert
    await row1.click();
    const staleDetail = page.locator('.vac-list-item').nth(1).locator('.vac-detail');
    await expect(staleDetail).toBeVisible();
    const staleAlert = staleDetail.locator('.vacancies-detail-trust-alert.is-stale');
    await expect(staleAlert).toBeVisible();
    await expect(staleAlert).toContainText('Вакансия открыта более 60 дней');

    // Screenshot of list with trust signals and detail panel
    await page.screenshot({
      path: `output/playwright/B262/trust-signals-stale-${vpSuffix}.png`,
      fullPage: true,
    });

    // 5. Click dead link item and verify detail panel trust alert
    await row2.click();
    const deadDetail = page.locator('.vac-list-item').nth(2).locator('.vac-detail');
    await expect(deadDetail).toBeVisible();
    const deadAlert = deadDetail.locator('.vacancies-detail-trust-alert.is-suspicious');
    await expect(deadAlert).toBeVisible();
    await expect(deadAlert).toContainText('Ссылка на вакансию недоступна');

    await page.screenshot({
      path: `output/playwright/B262/trust-signals-deadlink-${vpSuffix}.png`,
      fullPage: true,
    });
  });

  test('B324: view switch toggles map and city selection filters list', async ({ page }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const switchBar = page.locator('.view-switch[role="tablist"]');
    await expect(switchBar).toBeVisible();
    const mapTab = switchBar.getByRole('tab', { name: 'Карта' });
    const listTab = switchBar.getByRole('tab', { name: 'Список' });

    await mapTab.click();
    await expect(page.locator('.vacancy-map-view')).toBeVisible();

    // Select city on map
    const cityBtn = page.locator('.vacancy-map-cities button').first();
    if (await cityBtn.isVisible()) {
      await cityBtn.click();
    }

    // Switch back to list view
    await listTab.click();
    await expect(page.locator('.vacancies-list-container')).toBeVisible();
  });

  test('B324: role limit 10/10, adding and removing custom role in filter panel', async ({
    page,
  }) => {
    const tenRolesCampaign = {
      ...CAMPAIGN,
      roles: {
        value: Array.from({ length: 10 }, (_, i) => `Custom Role ${i + 1}`),
        origin: 'explicit' as const,
      },
      roleHypotheses: Array.from({ length: 10 }, (_, i) => ({
        role: `Custom Role ${i + 1}`,
        vacancyCount: 2,
        isHypothesis: false,
      })),
    };

    await stubSession(page, { campaign: tenRolesCampaign });
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const filterToggle = page.locator('.vacancies-mobile-filter-toggle');
    await filterToggle.click();

    const filters = page.locator('.filters-panel.is-expanded');
    await expect(filters).toBeVisible();

    // Verify limit note and disabled inputs
    const limitNote = filters.locator('.role-limit-note');
    await expect(limitNote).toContainText(
      'Достигнут предел — 10 из 10 ролей. Уберите одну, чтобы добавить другую.',
    );
    await expect(filters.locator('.add-role-input')).toBeDisabled();
    await expect(filters.locator('.add-role-row button')).toBeDisabled();
  });

  test('B324: saved searches panel toggles from filter bar', async ({ page }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const savedBtn = page.locator('.filters-bar .saved-btn');
    await expect(savedBtn).toBeVisible();
    await savedBtn.click();

    const savedSection = page.locator('.filters-panel[aria-label="Сохранённые поиски"]');
    await expect(savedSection).toBeVisible();

    await savedBtn.click();
    await expect(savedSection).not.toBeVisible();
  });

  test('B324: captures all 8 states at 1440 and 390', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name === 'mobile-390';
    const vpSuffix = isMobile ? '390' : '1440';

    // 1. list-filled (first row expanded)
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const firstItem = page.locator('.vac-list-item').first();
    const row = firstItem.locator('.vac-row');
    if ((await row.getAttribute('aria-expanded')) !== 'true') {
      await row.click();
    }
    await expect(firstItem.locator('.vac-detail')).toBeVisible();
    await page.screenshot({
      path: `output/playwright/B324/list-filled-${vpSuffix}.png`,
      fullPage: true,
    });

    // 2. filters-expanded
    const filterToggle = page.locator('.vacancies-mobile-filter-toggle');
    await filterToggle.click();
    await expect(page.locator('.filters-panel.is-expanded')).toBeVisible();
    await page.screenshot({
      path: `output/playwright/B324/filters-expanded-${vpSuffix}.png`,
      fullPage: true,
    });
    // Close filters panel
    await filterToggle.click();
    await expect(page.locator('.filters-panel.is-expanded')).not.toBeVisible();

    // 3. map-view
    const switchBar = page.locator('.view-switch[role="tablist"]');
    const mapTab = switchBar.getByRole('tab', { name: 'Карта' });
    await mapTab.click();
    await expect(page.locator('.vacancy-map-view')).toBeVisible();
    await page.screenshot({
      path: `output/playwright/B324/map-view-${vpSuffix}.png`,
      fullPage: true,
    });

    // 4. saved-searches
    const listTab = switchBar.getByRole('tab', { name: 'Список' });
    await listTab.click();
    await expect(page.locator('.vacancies-list-container')).toBeVisible();

    const savedBtn = page.locator('.filters-bar .saved-btn');
    await savedBtn.click();
    const savedSection = page.locator('.filters-panel[aria-label="Сохранённые поиски"]');
    await expect(savedSection).toBeVisible();
    await page.screenshot({
      path: `output/playwright/B324/saved-searches-${vpSuffix}.png`,
      fullPage: true,
    });
    await savedBtn.click();
    await expect(savedSection).not.toBeVisible();

    // 5. detail-modal
    const detailActions = firstItem.locator('.vac-detail .vacancies-detail-actions');
    const infoBtn = detailActions.getByRole('button', { name: 'Подробнее' });
    await infoBtn.click();
    const modal = page.locator('.career-modal-card.is-detail');
    await expect(modal).toBeVisible();
    await page.screenshot({
      path: `output/playwright/B324/detail-modal-${vpSuffix}.png`,
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();

    // 6. empty-state
    const emptyPage = await page.context().newPage();
    await stubSession(emptyPage, {
      matchedItems: [],
      total: 0,
      campaign: {
        ...CAMPAIGN,
        roleHypotheses: [{ role: 'Enterprise Architect', vacancyCount: 0, isHypothesis: true }],
      },
    });
    await seedWorkspace(emptyPage);
    await emptyPage.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(emptyPage);
    await expect(emptyPage.locator('.vacancies-state')).toBeVisible();
    await emptyPage.screenshot({
      path: `output/playwright/B324/empty-state-${vpSuffix}.png`,
      fullPage: true,
    });
    await emptyPage.close();

    // 7. skeleton
    const skeletonPage = await page.context().newPage();
    await stubSession(skeletonPage, { delayMatchedMs: 30_000 });
    await seedWorkspace(skeletonPage);
    await skeletonPage.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(skeletonPage);
    await expect(skeletonPage.locator('.skeleton-stack')).toBeVisible();
    await skeletonPage.screenshot({
      path: `output/playwright/B324/skeleton-${vpSuffix}.png`,
      fullPage: true,
    });
    await skeletonPage.close();

    // 8. error-state
    const errorPage = await page.context().newPage();
    await stubSession(errorPage, { failMatched: true });
    await seedWorkspace(errorPage);
    await errorPage.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(errorPage);
    await expect(errorPage.locator('.vacancies-state.is-error')).toBeVisible();
    await errorPage.screenshot({
      path: `output/playwright/B324/error-state-${vpSuffix}.png`,
      fullPage: true,
    });
    await errorPage.close();
  });

  test('B343: tooltip shows on hover on fit dot and rail toggle switches caption', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1176, height: 800 });
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    // 1. Hover fit dot -> shows "Уровень: рядом"
    const nearbyDot = page.locator('.fit-dot.is-nearby').first();
    await nearbyDot.hover();
    const tooltipBubble = page.locator('.career-tooltip-bubble[data-open="true"]');
    await expect(tooltipBubble).toBeVisible();
    await expect(tooltipBubble).toContainText('Уровень: рядом');
    await page.screenshot({ path: 'output/playwright/B343/tooltip-fit-dot-1176.png' });

    // 2. Rail toggle button -> test expand/collapse tooltip
    const railToggle = page.locator('.career-rail-toggle');
    await railToggle.hover();
    await expect(tooltipBubble).toContainText('Развернуть панель');
    await page.screenshot({ path: 'output/playwright/B343/tooltip-rail-toggle-1176.png' });

    await railToggle.click();
    await railToggle.hover();
    await expect(tooltipBubble).toContainText('Свернуть панель');

    // Also capture at 1440 and 390 per spec §5.4
    await page.setViewportSize({ width: 1440, height: 900 });
    await nearbyDot.hover();
    await expect(tooltipBubble).toContainText('Уровень: рядом');
    await page.screenshot({ path: 'output/playwright/B343/tooltip-fit-dot-1440.png' });

    await page.setViewportSize({ width: 390, height: 844 });
    await nearbyDot.hover();
    await expect(tooltipBubble).toContainText('Уровень: рядом');
    await page.screenshot({ path: 'output/playwright/B343/tooltip-fit-dot-390.png' });
  });
});
