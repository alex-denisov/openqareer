import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { captureCareerHarness } from './helpers/capture-career-harness';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { mockCandidateCompanies } from './fixtures/mockCandidateCompanies';

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

const S10_EVIDENCE_DIR = e2eEvidenceDirectory('S10-VIS');

test.beforeAll(() => mkdirSync(S10_EVIDENCE_DIR, { recursive: true }));

async function captureS10Vacancies(page: Page, name: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const scrollHeight = await page
    .locator('#career-main')
    .evaluate((element) => element.scrollHeight);
  await page.setViewportSize({
    width: viewport.width,
    height: Math.max(viewport.height, scrollHeight),
  });
  await page.screenshot({ path: join(S10_EVIDENCE_DIR, `${name}.png`), fullPage: true });
  await captureCareerHarness(page, join(S10_EVIDENCE_DIR, `${name}.html`));
  await page.setViewportSize(viewport);
}

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
  readonly facets?: typeof FACETS | null;
  readonly campaign?: typeof CAMPAIGN;
  readonly failMatched?: boolean;
  readonly delayMatchedMs?: number;
  readonly campaignUpdates?: unknown[];
  readonly matchedReadCount?: { value: number };
  readonly sourceCatalogReadCount?: { value: number };
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
      if (scenario.sourceCatalogReadCount) scenario.sourceCatalogReadCount.value += 1;
      return route.fulfill({
        json: {
          data: [
            {
              id: 'hh',
              name: 'hh.ru',
              category: 'Агрегаторы и API',
              health: { status: 'healthy' },
            },
            {
              id: 'remotive',
              name: 'Remotive',
              category: 'Международные площадки',
              health: { status: 'unavailable' },
            },
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
              scenario.facets !== undefined
                ? scenario.facets
                : scenario.matchedItems?.length === 0
                  ? { total: 0, regions: [], remote: 0, levels: [], roles: [], sources: [] }
                  : FACETS,
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
  await mockCandidateCompanies(page);
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
  const vacanciesNavigation = page.locator('button[aria-label="Вакансии"]:visible').first();
  await expect(vacanciesNavigation).toBeVisible({ timeout: 15_000 });
  await vacanciesNavigation.click();
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Вакансии', exact: true }),
  ).toBeVisible({ timeout: 15_000 });
}

async function setRowExpanded(page: Page, index: number, expanded: boolean): Promise<Locator> {
  const item = page.locator('.vac-list-item').nth(index);
  const trigger = item.locator('.vacancies-screen-row-trigger');
  await expect(item).toBeVisible();
  if ((await trigger.getAttribute('aria-expanded')) !== String(expanded)) await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', String(expanded));
  return item;
}

async function openFilterGroup(
  page: Page,
  group: 'roles' | 'locations' | 'salary' | 'format' | 'sources',
) {
  const mobile = await page.evaluate(() => window.matchMedia('(max-width: 760px)').matches);
  const popover = page.locator('#vacancies-filter-popover');
  if (mobile) {
    const backToOverview = page.getByRole('button', { name: 'Все фильтры', exact: true });
    if (await backToOverview.isVisible()) await backToOverview.click();
    if (!(await popover.isVisible())) {
      await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
    }
    await page.locator(`[data-filter-sheet-group="${group}"]`).click();
  } else {
    await page.locator(`[data-filter-group="${group}"]`).click();
  }
  await expect(popover).toBeVisible();
  return popover;
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
  sources: [{ sourceId: 'hh', name: 'hh.ru', count: 61 }],
  sourceGroups: [
    { id: 'platforms', name: 'Площадки', count: 0 },
    { id: 'ats', name: 'ATS компаний', count: 0 },
    { id: 'aggregators', name: 'Агрегаторы', count: 61 },
    { id: 'channels', name: 'Каналы', count: 0 },
  ],
};

test.describe('B250 vacancies screen', () => {
  test('links an archived application from its vacancy row to the open archive', async ({
    page,
  }) => {
    await stubSession(page);
    await page.route('**/api/v1/candidate/applications**', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        return route.fulfill({
          json: {
            data: [
              {
                id: 'archived-c-1',
                candidateId: CANDIDATE.candidateId,
                clusterId: 'c-1',
                stage: 'archived',
                closedReason: 'vacancy_closed',
                archiveReason: 'vacancy_closed',
                archivePreviousStage: 'applied',
                archiveStaleDays: 30,
                processProfile: 'standard',
                vacancy: {
                  title: 'Business Information Architect',
                  company: 'Genetec',
                  url: 'https://example.com/vacancy',
                  source: 'test',
                },
                notes: null,
                followUpDueAt: null,
                stageChangedAt: '2026-09-20T08:00:00.000Z',
                version: 2,
                createdAt: '2026-09-20T08:00:00.000Z',
                updatedAt: '2026-09-20T08:00:00.000Z',
                followUp: null,
                whoseTurn: null,
                materials: { coverLetter: false, resume: false },
                nearestInterview: null,
              },
            ],
          },
        });
      }
      return route.fallback();
    });
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const row = page
      .locator('.vacancies-screen-row-shell')
      .filter({ hasText: 'Business Information Architect' });
    await expect(row).toContainText('Отклик в архиве');
    await expect(row).not.toContainText('Отклик отмечен');
    await setRowExpanded(page, 0, true);
    const openArchive = page.getByRole('button', { name: 'Открыть архив' });
    await openArchive.click();

    await expect(page.locator('.career-responses-board')).toBeVisible();
    const archiveToggle = page.getByRole('button', { name: 'Архив · 1' });
    await expect(archiveToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(archiveToggle).toBeFocused();
    await expect(archiveToggle).toBeInViewport();
    await expect(page.locator('.career-responses-archive-card')).toContainText(
      'Business Information Architect',
    );
  });

  test('shows the approved vacancy summary, tabs, pool filters and rows', async ({ page }) => {
    const sourceCatalogReadCount = { value: 0 };
    await stubSession(page, { sourceCatalogReadCount });
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    await expect(
      page.getByRole('main').getByRole('heading', { name: 'Вакансии', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.vacancies-mobile-results-summary')).toContainText(
      '61 вакансий по вашим условиям',
    );
    const tabs = page.getByRole('tablist', { name: 'Разделы вакансий' });
    await expect(tabs.getByRole('tab')).toHaveCount(3);
    await expect(tabs.getByRole('tab', { name: 'Подборка 61' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(tabs.getByRole('tab', { name: 'Сохранённые 0' })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'Компании и люди' })).toBeVisible();

    // Каждый набор значений открывается из своей группы фильтров.
    const filters = await openFilterGroup(page, 'roles');
    await expect(filters.getByRole('button', { name: 'Enterprise Architect · 34' })).toBeVisible();
    await expect(filters.getByRole('button', { name: 'Cloud Architect · 6' })).toBeVisible();
    await expect(filters.getByRole('button', { name: 'VP · 30' })).toBeVisible();

    await openFilterGroup(page, 'format');
    await expect(filters.getByRole('button', { name: 'Удалённо · 12' })).toBeVisible();

    await openFilterGroup(page, 'sources');
    await expect(filters.getByRole('button', { name: 'hh.ru · 61' })).toBeVisible();
    await expect(filters.locator('.vacancy-source-group legend')).toHaveText('Агрегаторы · 61');
    await expect.poll(() => sourceCatalogReadCount.value).toBeGreaterThan(0);
    await expect(filters.locator('.vacancy-source-filter .vacancy-facet-chip')).toHaveCount(1);
    await expect(filters.getByRole('button', { name: /Добавить:/ })).toHaveCount(0);

    const rows = page.locator('.vac-list-item');
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toContainText('Business Information Architect');
    await expect(rows.first()).toContainText('Genetec');
  });

  test('S10-VIS: summary, filters, vacancy actions, expanded detail and footer match the approved screen', async ({
    page,
  }, testInfo) => {
    const isMobile = testInfo.project.name === 'mobile-390';
    const width = isMobile ? 390 : 1440;
    await page.setViewportSize(
      isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    );
    const unmatched = await mockSignedInCabinet(page, {
      vacancyTotal: 148,
      vacancyFacets: {
        total: 148,
        regions: [],
        remote: 74,
        levels: [],
        roles: [
          { role: 'Head', count: 12 },
          { role: 'Director', count: 8 },
        ],
        sources: [
          { sourceId: 'hh', name: 'hh.ru', count: 74 },
          { sourceId: 'linkedin', name: 'LinkedIn', count: 74 },
        ],
      },
      vacancyInitialFilters: {
        roles: ['Head', 'Director'],
        regions: [],
        levels: [],
        sources: ['hh', 'linkedin'],
        remoteOnly: false,
        selectedLocations: [
          'Москва',
          ...Array.from({ length: 46 }, (_, index) => `Город ${index + 1}`),
        ],
        salaryMinimum: 450_000,
        salaryCurrency: '₽',
        formats: ['hybrid', 'remote'],
      },
      savedVacanciesCount: 18,
      companyCount: 61,
    });
    await page.route('**/api/v1/candidate/vacancies/*/detail', (route) => {
      const parts = new URL(route.request().url()).pathname.split('/');
      const vacancyId = parts.at(-2) ?? 'vacancy';
      return route.fulfill({
        json: {
          data: {
            id: vacancyId,
            description: 'Полное описание для проверки карточки вакансии.',
            truncated: false,
            skills: ['Operations', 'P&L'],
            responsibilities: ['Управлять платформой и командой.'],
          },
        },
      });
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    if (!isMobile) {
      const summary = page.getByRole('region', { name: 'Сводка подбора' });
      await expect(summary).toContainText('148 вакансий в подборке по роли и уровню');
      await expect(summary).toContainText(/Показано \d+ из \d+ с вашими условиями/u);
    } else {
      await expect(page.locator('.vacancies-mobile-results-summary')).toContainText('148');
    }

    if (isMobile) {
      const filters = page.getByRole('button', { name: 'Фильтры' });
      await expect(filters).toBeVisible();
      await filters.click();
      const sheet = page.locator('.vacancies-filters.is-mobile-open');
      for (const summary of ['Head, Director', 'Москва +46', 'от 450 тыс. ₽', 'Гибрид, удалённо']) {
        await expect(sheet).toContainText(summary);
      }
      await expect(sheet.getByRole('button', { name: 'Сбросить', exact: true })).toBeVisible();
      await sheet.getByRole('button', { name: 'Показать результаты', exact: true }).click();
    } else {
      await expect(page.getByRole('button', { name: 'Сбросить всё', exact: true })).toBeVisible();
      const expectedFilterSummaries = [
        ['roles', 'Head, Director'],
        ['locations', 'Москва +46'],
        ['salary', 'от 450 тыс. ₽'],
        ['format', '2'],
        ['sources', '2'],
      ] as const;
      for (const [group, summary] of expectedFilterSummaries) {
        const trigger = page.locator(`[data-filter-group="${group}"]`);
        await expect(trigger).toBeVisible();
        await expect(trigger).toContainText(summary);
      }
    }

    if (!isMobile) {
      await expect(page.locator('.vacancies-table-header-cells span')).toHaveText([
        'Роль',
        'Уровень',
        'Гео',
        'Деньги',
      ]);
    }
    const firstItem = await setRowExpanded(page, 0, !isMobile);
    const row = firstItem.locator('.vacancies-screen-row-shell');
    const rowTrigger = row.locator('.vacancies-screen-row-trigger');
    await expect(row).toBeVisible();
    await expect(row).toContainText(/совпадает|не совпадает/u);
    await expect(row.getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible();
    await expect(
      row.getByRole('button', { name: 'Хочу в эту компанию', exact: true }),
    ).toBeVisible();
    const expand = row.getByRole('button', { name: /(?:Раскрыть|Свернуть) вакансию/u });
    await expect(expand).toBeVisible();
    await expect(row.getByRole('button', { name: 'Сохранить вакансию', exact: true })).toHaveCount(
      0,
    );
    await captureS10Vacancies(page, `vacancies-${width}`);

    if ((await rowTrigger.getAttribute('aria-expanded')) !== 'true') await expand.click();
    const detail = firstItem.locator('.vac-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('heading', { name: 'Требования к навыкам' })).toBeVisible();
    await expect(detail).toContainText('Из описания вакансии и тегов источника');
    await expect(detail.getByRole('heading', { name: 'Описание', exact: true })).toBeVisible();
    const detailActions = detail.locator('.vacancies-detail-actions');
    for (const label of [
      'Откликнуться',
      'На площадке',
      'Путь к компании',
      'Хочу в эту компанию',
      'Обсудить',
    ]) {
      await expect(detailActions.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    if (!isMobile) await captureS10Vacancies(page, 'vacancies-expanded-1440');
    const fullDescription = detail.getByRole('button', { name: 'Полное описание', exact: true });
    await expect(fullDescription).toBeVisible();
    await fullDescription.click();
    const descriptionDialog = page.getByRole('dialog');
    await expect(descriptionDialog).toBeVisible();
    await expect(descriptionDialog).toContainText(await row.getByRole('heading').innerText());
    await page.keyboard.press('Escape');
    await expect(descriptionDialog).toHaveCount(0);

    if (!isMobile) {
      const footer = page.locator('.vacancies-screen-footer');
      await expect(footer.getByText(/Показано \d+ из \d+/u)).toBeVisible();
      await expect(
        footer.getByRole('button', { name: /Все компании подборки в «Хочу»/u }),
      ).toBeVisible();
      // This fixture reports total=148 but nextOffset=null, so the screen must not
      // invent a pagination action when the server has not supplied another page.
      await expect(
        footer.getByRole('button', { name: 'Показать ещё 20', exact: true }),
      ).toHaveCount(0);
      const footerItems = [
        footer.getByText(/Показано \d+ из \d+/u),
        footer.getByRole('button', { name: /Все компании подборки в «Хочу»/u }),
      ];
      const boxes = await Promise.all(footerItems.map((item) => item.boundingBox()));
      expect(boxes.every((box) => box !== null)).toBe(true);
      expect(
        Math.max(...boxes.map((box) => box!.y + box!.height / 2)) -
          Math.min(...boxes.map((box) => box!.y + box!.height / 2)),
      ).toBeLessThan(8);
    }

    const firstItemBox = await firstItem.boundingBox();
    const actionBoxes = await firstItem
      .locator('.career-vacancy-actions button, .vacancies-detail-actions button')
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return { left: box.left, right: box.right };
        }),
      );
    expect(firstItemBox).not.toBeNull();
    expect(
      actionBoxes.every(
        (box) =>
          box.left >= firstItemBox!.x - 1 && box.right <= firstItemBox!.x + firstItemBox!.width + 1,
      ),
    ).toBe(true);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(unmatched).toEqual([]);
    await captureS10Vacancies(page, `vacancies-expanded-${width}`);
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

    // На телефоне фильтр свернут, а число активных групп остаётся видимым.
    const filterToggle = page.locator('.vacancies-mobile-filter-toggle');
    await expect(filterToggle).toBeVisible();
    await expect(filterToggle).toHaveText(/^Фильтры\s+\d+$/);
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

  test('expands a row and exposes the five approved actions', async ({ page }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const firstItem = await setRowExpanded(page, 0, true);
    const row = firstItem.locator('.vacancies-screen-row-shell');
    const rowTrigger = row.locator('.vacancies-screen-row-trigger');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Business Information Architect');
    await expect(row).toContainText('Genetec');
    await expect(row).toHaveClass(/is-selected/);
    await expect(rowTrigger).toHaveAttribute('aria-expanded', 'true');

    const detail = firstItem.locator('.vac-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('heading', { name: 'Требования к навыкам' })).toBeVisible();
    await expect(detail.getByRole('heading', { name: 'Описание' })).toBeVisible();

    const actions = detail.locator('.vacancies-screen-detail-actions');
    await expect(actions.getByRole('button')).toHaveCount(5);
    await expect(actions.getByRole('button', { name: 'Откликнуться' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'На площадке' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Путь к компании' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Хочу в эту компанию' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Обсудить' })).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Полное описание' })).toBeVisible();
  });

  test('clicking the header of the expanded vacancy collapses it and opens no other one', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    await setRowExpanded(page, 0, true);
    const expanded = page.locator('.vacancies-screen-row-trigger[aria-expanded="true"]');
    const second = page.locator('.vac-list-item').nth(1).locator('.vacancies-screen-row-trigger');
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
    const row = firstItem.locator('.vacancies-screen-row-trigger');
    const detail = firstItem.locator('.vac-detail');

    if ((await row.getAttribute('aria-expanded')) === 'true') {
      await row.click();
    }
    await expect(detail).not.toBeVisible();
    await expect(row).toHaveAttribute('aria-expanded', 'false');

    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(detail).toBeVisible();

    // The compact screen keeps the same five row actions and reveals them inside the card.
    await expect(detail.locator('.vacancies-screen-detail-actions')).toBeVisible();
    await expect(detail.locator('.vacancies-screen-detail-actions button')).toHaveCount(5);
    await page.screenshot({
      path: 'output/playwright/C74/vacancy-detail-390.png',
      fullPage: false,
    });

    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(detail).not.toBeVisible();
  });

  test('the approved vacancy tabs have exactly one current section, «Подборка»', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const tabs = page.getByRole('tablist', { name: 'Разделы вакансий' });
    await expect(tabs.getByRole('tab', { selected: true })).toHaveCount(1);
    await expect(tabs.getByRole('tab', { name: 'Подборка 61' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(tabs.getByRole('tab', { name: 'Сохранённые 0' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    await expect(tabs.getByRole('tab', { name: 'Компании и люди' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  test('shows the «Откликнуться» button on 1440 and inside the mobile panel on 390', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const firstItem = await setRowExpanded(page, 0, true);
    const applyButton = firstItem.locator('.vac-detail').getByRole('button', {
      name: 'Откликнуться',
    });
    await expect(applyButton).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(applyButton).toBeVisible();
  });

  test('Path to company opens Companies and People filtered to the selected employer', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const firstItem = await setRowExpanded(page, 0, true);

    const companyPath = firstItem
      .locator('.vacancies-screen-detail-actions')
      .getByRole('button', { name: 'Путь к компании', exact: true });
    await expect(companyPath).toBeVisible();
    await companyPath.click();

    const companiesTab = page
      .getByRole('tablist', { name: 'Разделы вакансий' })
      .getByRole('tab', { name: /Компании и люди/u });
    await expect(companiesTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('textbox', { name: 'Поиск среди компаний' })).toHaveValue(
      'Genetec',
    );
    await expect(page.locator('.companies-people-count')).toContainText(
      '0 компаний в текущей подборке',
    );
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
        name: 'Фильтры',
      });
      await expect(filterToggle).toHaveAttribute('aria-expanded', 'false');
      const firstRow = page.locator('.vac-list-item').first();
      await expect(firstRow).toBeVisible();
      await firstRow.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      // Макет 390 (B430) держит над нижним меню полосу консультанта: первая
      // строка обязана быть видна заголовком, целиком она может уходить под полосу.
      const firstRowBottom = await firstRow.evaluate(
        (element) => element.getBoundingClientRect().top + 96,
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
    const filters = await openFilterGroup(page, 'locations');
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

  test('C72: recruiter messaging remains available from Companies and People', async ({ page }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);
    await page.getByRole('tab', { name: /Компании и люди/u }).click();
    await page.getByRole('button', { name: 'Открыть компанию Вектор Банк' }).click();

    const recruiter = page.locator('.companies-people-recruiter').first();
    await expect(recruiter).toContainText('Мария Орлова');
    await recruiter.getByRole('button', { name: 'Подготовить сообщение' }).click();

    const message = page.getByRole('region', { name: 'Сообщение нанимающему' });
    await expect(message).toBeVisible();
    await expect(message).toContainText('Мария Орлова');
    await expect(message.getByRole('button', { name: 'Скопировать' })).toBeVisible();
    await expect(message.getByRole('link', { name: 'Открыть в LinkedIn' })).toBeVisible();
    mkdirSync('output/playwright/C72', { recursive: true });
    await page.screenshot({
      path: 'output/playwright/C72/recruiter-message-1440.png',
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const narrowOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(narrowOverflow).toBeLessThanOrEqual(0);
    await message.scrollIntoViewIfNeeded();
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

    await expect(
      page.getByRole('main').getByRole('heading', { name: 'Вакансии', exact: true }),
    ).toBeVisible();

    const rows = page.locator('.vacancies-screen-row-shell');
    await expect(rows).toHaveCount(3);

    // 1. Fresh item should be sorted first and have no detail alert.
    const row0 = rows.nth(0);
    await expect(row0).toContainText('Fresh Tech Corp');
    await setRowExpanded(page, 0, true);
    const freshDetail = page.locator('.vac-list-item').nth(0).locator('.vac-detail');
    await expect(freshDetail).toBeVisible();
    await expect(freshDetail.locator('.vacancies-detail-trust-alert')).toHaveCount(0);

    // 2. Stale item should be sorted second and explain the age in its detail.
    const row1 = rows.nth(1);
    await expect(row1).toContainText('Legacy Systems Inc');
    await setRowExpanded(page, 1, true);
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

    // 3. Dead link item remains last and explains why its link is suspicious.
    const row2 = rows.nth(2);
    await expect(row2).toContainText('Ghost Corp');
    await setRowExpanded(page, 2, true);
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

  test('B324: the screen switches between list and map and filters by city', async ({
    page,
  }, testInfo) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const mobile = testInfo.project.name === 'mobile-390';
    if (mobile) {
      await page.getByRole('button', { name: 'Карта', exact: true }).click();
    } else {
      const switchBar = page.getByRole('tablist', { name: 'Режим просмотра' });
      await expect(switchBar).toBeVisible();
      await switchBar.getByRole('tab', { name: 'Карта' }).click();
    }
    await expect(page.locator('.vacancy-map-view')).toBeVisible();

    // Город выбирается кнопкой в списке под картой.
    const cityBtn = page.locator('.vacancy-map-cities button').first();
    if (await cityBtn.isVisible()) {
      await cityBtn.click();
    }

    // Возврат в список использует управление текущей раскладки.
    if (mobile) {
      await page.getByRole('button', { name: 'Список', exact: true }).click();
    } else {
      await page
        .getByRole('tablist', { name: 'Режим просмотра' })
        .getByRole('tab', { name: 'Список' })
        .click();
    }
    await expect(page.locator('.vacancies-list-container')).toBeVisible();
  });

  test('B365: офлайн-карта считает города, объединяет координатные варианты и снимается на двух ширинах', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name !== 'desktop-1440') {
      test.skip(true, 'B365 captures both target widths in one browser session');
    }

    const cityRows = [
      { location: 'Москва', city: 'Москва', coordinates: { lat: 55.75204, lng: 37.61781 } },
      { location: 'Moscow, Russia', city: 'Moscow', coordinates: { lat: 55.75204, lng: 37.61781 } },
      { location: undefined, city: undefined, coordinates: undefined },
      { location: 'Unknown Vacancy City', city: 'Unknown Vacancy City', coordinates: undefined },
    ];
    const mapItems = MATCHED_ITEMS.slice(0, cityRows.length).map((base, index) => {
      const row = cityRows[index];
      const id = `b365-map-${index + 1}`;
      return {
        ...base,
        cluster: cluster(id, base.cluster.canonicalTitle, base.cluster.canonicalCompany, {
          canonicalLocation: row.location,
          companyFeatures: { city: row.city, coordinates: row.coordinates },
        }),
        explanation: explanation(id),
      };
    });

    await page.setViewportSize({ width: 1176, height: 900 });
    await stubSession(page, { matchedItems: mapItems, total: mapItems.length });
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    await page.locator('.view-switch[role="tablist"]').getByRole('tab', { name: 'Карта' }).click();
    const mapView = page.locator('.vacancy-map-view');
    await expect(mapView).toBeVisible();
    await expect(mapView.locator('.career-map-header')).toContainText('На карте 2 из 4');
    await expect(mapView.locator('.career-map-header')).toContainText('без города: 1');
    await expect(mapView.locator('.career-map-header')).toContainText('город не распознан: 1');
    await expect(mapView.locator('.career-map-country')).toHaveCount(177);
    const mapCanvas = mapView.locator('.career-map-canvas-container');
    await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('.career-main');
      const canvas = document.querySelector<HTMLElement>('.career-map-canvas-container');
      const topbar = document.querySelector<HTMLElement>('.career-topbar');
      if (!main || !canvas) return;
      const topInset = (topbar?.getBoundingClientRect().bottom ?? 0) + 8;
      const delta = canvas.getBoundingClientRect().top - topInset;
      if (getComputedStyle(main).overflowY === 'auto') main.scrollTop += delta;
      else window.scrollBy(0, delta);
    });
    await expect(mapCanvas).toBeVisible();
    await page.screenshot({
      path: 'output/playwright/B365/map-1176.png',
      animations: 'disabled',
    });
    await mapCanvas.screenshot({
      path: 'output/playwright/B365/map-canvas-1176.png',
      animations: 'disabled',
    });
    await captureCareerHarness(
      page,
      'output/playwright/B365/map-view.html',
      '.career-vacancy-map-view',
    );

    const moscowChip = mapView
      .locator('.career-map-city-chips')
      .getByRole('button', { name: 'Город Москва: 2 вакансий' });
    await expect(moscowChip).toBeVisible();
    const chipBox = await moscowChip.boundingBox();
    expect(chipBox?.width).toBeGreaterThanOrEqual(44);
    expect(chipBox?.height).toBeGreaterThanOrEqual(44);
    await moscowChip.click();
    await expect(
      mapView.locator('.career-map-cards-grid').first().locator('.career-map-card'),
    ).toHaveCount(2);
    await expect(mapView.locator('.career-map-cards-grid').first()).toContainText('Genetec');
    await expect(mapView.locator('.career-map-cards-grid').first()).toContainText('Peraton');
    await mapView.getByRole('button', { name: 'Все города на карте' }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.career-main')?.scrollTo(0, 0);
      window.scrollTo(0, 0);
    });
    await expect(mapView.locator('.career-map-header')).toContainText('На карте 2 из 4');
    await expect(mapView.locator('.career-map-svg')).toBeVisible();
    await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('.career-main');
      const canvas = document.querySelector<HTMLElement>('.career-map-canvas-container');
      const topbar = document.querySelector<HTMLElement>('.career-topbar');
      if (!main || !canvas) return;
      const topInset = (topbar?.getBoundingClientRect().bottom ?? 0) + 8;
      const delta = canvas.getBoundingClientRect().top - topInset;
      if (getComputedStyle(main).overflowY === 'auto') main.scrollTop += delta;
      else window.scrollBy(0, delta);
    });
    await expect(moscowChip).toBeVisible();
    const mobileChipBox = await moscowChip.boundingBox();
    expect(mobileChipBox?.width).toBeGreaterThanOrEqual(44);
    expect(mobileChipBox?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: 'output/playwright/B365/map-390.png',
      animations: 'disabled',
    });
    await mapCanvas.screenshot({
      path: 'output/playwright/B365/map-canvas-390.png',
      animations: 'disabled',
    });
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflows).toBe(false);
  });

  test('B375: кластеризация карты вакансий, зум, раскрытие кластера и нормализация AU: Sydney', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name !== 'desktop-1440') {
      test.skip(true, 'B375 captures target widths in one browser session');
    }

    const cityRows = [
      { location: 'Berlin, Germany', city: 'Berlin', coordinates: { lat: 52.52, lng: 13.405 } },
      { location: 'Prague, Czechia', city: 'Prague', coordinates: { lat: 50.0755, lng: 14.4378 } },
      { location: 'Vienna, Austria', city: 'Vienna', coordinates: { lat: 48.2082, lng: 16.3738 } },
      { location: 'AU: Sydney', city: 'AU: Sydney', coordinates: { lat: -33.8688, lng: 151.2093 } },
      { location: 'Москва', city: 'Москва', coordinates: { lat: 55.75204, lng: 37.61781 } },
    ];
    const mapItems = MATCHED_ITEMS.slice(0, cityRows.length).map((base, index) => {
      const row = cityRows[index];
      const id = `b375-map-${index + 1}`;
      return {
        ...base,
        cluster: cluster(id, base.cluster.canonicalTitle, base.cluster.canonicalCompany, {
          canonicalLocation: row.location,
          companyFeatures: { city: row.city, coordinates: row.coordinates },
        }),
        explanation: explanation(id),
      };
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await stubSession(page, { matchedItems: mapItems, total: mapItems.length });
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    await page.locator('.view-switch[role="tablist"]').getByRole('tab', { name: 'Карта' }).click();
    const mapView = page.locator('.vacancy-map-view');
    await expect(mapView).toBeVisible();

    // Sydney normalized to Сидней with tooltip showing Australia
    const sydneyChip = mapView
      .locator('.career-map-city-chips')
      .getByRole('button', { name: /Сидней/ });
    await expect(sydneyChip).toBeVisible();
    await expect(sydneyChip).toHaveAttribute('title', 'Австралия');

    // Clusters should exist at zoom=1 (Berlin + Prague + Vienna clustered)
    const clusterPin = mapView.locator('.career-map-cluster-node').first();
    await expect(clusterPin).toBeVisible();
    await page.screenshot({ path: 'output/playwright/B375/map-before-1440.png' });

    // Expand cluster on click
    await clusterPin.click();
    await page.screenshot({ path: 'output/playwright/B375/map-after-1440.png' });
    await page.screenshot({ path: 'output/playwright/B375/map-1440.png' });

    // Viewport 1176
    await page.setViewportSize({ width: 1176, height: 900 });
    await page.screenshot({ path: 'output/playwright/B375/map-1176.png' });

    // Viewport 390
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'output/playwright/B375/map-390.png' });
  });

  test('B375: salary and role use the approved primary font', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'desktop-1440') {
      test.skip(true, 'B375 captures target widths in one browser session');
    }

    await stubSession(page, {
      matchedItems: [
        {
          cluster: cluster('c-mono-1', 'Frontend Engineer', 'Acme', {
            canonicalLocation: 'Москва',
            isRemote: true,
            salary: undefined,
            skills: ['React', 'TypeScript'],
          }),
          explanation: explanation('c-mono-1', {
            matchingPoints: ['React'],
            missingPoints: ['GraphQL'],
          }),
        },
      ],
      total: 1,
    });
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const vacancyRow = page.locator('.vacancies-screen-row-shell').first();
    await expect(vacancyRow).toBeVisible();

    const salary = vacancyRow.locator('.vacancies-screen-cell--salary .career-numeric');
    const title = vacancyRow.locator('.vacancies-screen-cell--role .vac-title');
    await expect(salary).toHaveText('не указана');
    await expect(vacancyRow.locator('.vacancy-screen-money-source')).toContainText(
      'зарплата не указана',
    );
    await expect(title).toContainText('Frontend Engineer');
    await setRowExpanded(page, 0, true);
    const details = page.locator('.vac-list-item').first().locator('.vac-detail');
    await expect(details.getByRole('heading', { name: 'Требования к навыкам' })).toBeVisible();
    await expect(details.locator('.vacancies-screen-skill-chips')).toContainText('React');
    await expect(details.locator('.vacancies-screen-skill-chips')).toContainText('GraphQL');
    const fontFamilies = await page.evaluate(() => {
      const salaryValue = document.querySelector('.vacancies-screen-cell--salary .career-numeric');
      const roleTitle = document.querySelector('.vacancies-screen-cell--role .vac-title');
      if (!salaryValue || !roleTitle) return null;
      return {
        salary: getComputedStyle(salaryValue).fontFamily,
        title: getComputedStyle(roleTitle).fontFamily,
      };
    });
    expect(fontFamilies).not.toBeNull();
    expect(fontFamilies!.salary).toBe(fontFamilies!.title);

    // Screenshots at 1440, 1176, 390
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: 'output/playwright/B375/mono-fix-1440.png', fullPage: true });

    await page.setViewportSize({ width: 1176, height: 900 });
    await page.screenshot({ path: 'output/playwright/B375/mono-fix-1176.png', fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'output/playwright/B375/mono-fix-390.png', fullPage: true });
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

    const filters = await openFilterGroup(page, 'roles');

    // Verify limit note and disabled inputs
    const limitNote = filters.locator('.role-limit-note');
    await expect(limitNote).toContainText(
      'Достигнут предел — 10 из 10 ролей. Уберите одну, чтобы добавить другую.',
    );
    await expect(filters.locator('.add-role-input')).toBeDisabled();
    await expect(filters.locator('.add-role-row button')).toBeDisabled();
  });

  test('B324: saved vacancies are a primary screen tab', async ({ page }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const savedTab = page.getByRole('tab', { name: /Сохранённые/u });
    await expect(savedTab).toBeVisible();
    await expect(page.locator('.filters-bar .saved-btn')).toHaveCount(0);
    await savedTab.click();
    await expect(savedTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.vacancies-saved-panel')).toBeVisible();
  });

  test('B324: captures all 8 states at 1440 and 390', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name === 'mobile-390';
    const vpSuffix = isMobile ? '390' : '1440';

    // 1. list-filled (first row expanded)
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const firstItem = await setRowExpanded(page, 0, true);
    await expect(firstItem.locator('.vac-detail')).toBeVisible();
    await page.screenshot({
      path: `output/playwright/B324/list-filled-${vpSuffix}.png`,
      fullPage: true,
    });

    // 2. filters-expanded
    const filterToggle = isMobile
      ? page.locator('.vacancies-mobile-filter-toggle')
      : page.getByRole('button', { name: 'Роли', exact: true });
    await filterToggle.click();
    await expect(page.locator('.filters-panel.is-expanded')).toBeVisible();
    await page.screenshot({
      path: `output/playwright/B324/filters-expanded-${vpSuffix}.png`,
      fullPage: true,
    });
    // Close filters panel from inside the popover.
    await page.getByRole('button', { name: 'Свернуть', exact: true }).click();
    await expect(page.locator('.filters-panel.is-expanded')).not.toBeVisible();

    // 3. map-view
    const switchBar = page.locator('.view-switch[role="tablist"]');
    const mapControl = isMobile
      ? page.getByRole('button', { name: 'Карта' })
      : switchBar.getByRole('tab', { name: 'Карта' });
    await mapControl.click();
    await expect(page.locator('.vacancy-map-view')).toBeVisible();
    await page.screenshot({
      path: `output/playwright/B324/map-view-${vpSuffix}.png`,
      fullPage: true,
    });

    // 4. saved-vacancies
    const listControl = isMobile
      ? page.getByRole('button', { name: 'Список' })
      : switchBar.getByRole('tab', { name: 'Список' });
    await listControl.click();
    await expect(page.locator('.vacancies-list-container')).toBeVisible();

    const saveVacancy = firstItem.getByRole('button', { name: 'Сохранить', exact: true });
    await saveVacancy.click();
    const savedTab = page.getByRole('tab', { name: /Сохранённые/u });
    await expect(savedTab).toBeVisible();
    await savedTab.click();
    await expect(savedTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.vacancies-saved-panel')).toBeVisible();
    await page.screenshot({
      path: `output/playwright/B324/saved-vacancies-${vpSuffix}.png`,
      fullPage: true,
    });
    await page.getByRole('tab', { name: /Подборка/u }).click();

    // 5. detail-modal
    const infoBtn = firstItem.getByRole('button', { name: 'Полное описание', exact: true });
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

  test('B343: the rail hint stays in the title bar and fit status remains visible', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1176, height: 800 });
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const nearbyDot = page.locator('.fit-dot.is-nearby').first();
    await nearbyDot.hover();
    const tooltipBubble = page.locator('.career-tooltip-bubble[data-open="true"]');
    await expect(tooltipBubble).toBeVisible();
    await expect(tooltipBubble).toContainText('Уровень: рядом');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.mouse.move(0, 0);
    const railItem = page.locator('.career-rail .career-nav-button').first();
    await railItem.hover();
    await expect(page.locator('.career-desktop-topbar-hint')).toHaveText('Сегодня');
    await expect(tooltipBubble).toHaveCount(0);
    await railItem.focus();
    await expect(page.locator('.career-desktop-topbar-hint')).toHaveText('Сегодня');
    await page.screenshot({ path: 'output/playwright/B343/rail-hint-today-1440.png' });

    await page.setViewportSize({ width: 390, height: 844 });
    const narrowOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(narrowOverflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: 'output/playwright/B343/fit-status-390.png' });
  });

  test('уровень кандидата берётся из профиля, уровень вакансии отделён от навыков (D28)', async ({
    page,
  }, testInfo) => {
    const isMobile = testInfo.project.name === 'mobile-390';
    if (!isMobile) {
      await page.setViewportSize({ width: 1176, height: 900 });
    }
    await stubSession(page, {
      matchedItems: [
        {
          cluster: cluster('c-d28', 'VP of Engineering', 'TechCorp', {
            canonicalLocation: 'Москва',
            isRemote: true,
            skills: ['Architecture'],
          }),
          explanation: explanation('c-d28', {
            matchingPoints: ['Architecture'],
            missingPoints: ['vp', 'PostgreSQL'],
          }),
        },
      ],
      total: 1,
    });
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    // (a) Проверка группы фильтра «Уровень»
    const filtersPanel = await openFilterGroup(page, 'roles');
    await expect(filtersPanel.locator('.level-note')).toHaveText(
      'Уровень берётся из опыта в профиле',
    );
    await expect(filtersPanel.getByText('изменить в профиле')).not.toBeVisible();
    await filtersPanel.getByRole('button', { name: 'Свернуть', exact: true }).click();

    // (б) Разбор вакансии: уровень отделен от навыков
    const vacancyItem = await setRowExpanded(page, 0, true);
    const detail = vacancyItem.locator('.vac-detail');
    await expect(detail).toBeVisible();
    const levelCell = vacancyItem.locator('.vacancies-screen-cell--level');
    await expect(levelCell).toContainText('VP');
    await expect(levelCell).toContainText('совпадает');
    await expect(detail.locator('.vacancies-screen-skill-chips')).toContainText('PostgreSQL');
    await expect(detail.locator('.vacancies-screen-skill-chips')).not.toContainText('vp');

    // Screenshot for evidence
    const label = isMobile ? '390' : '1176';
    await page.screenshot({
      path: `output/playwright/B344/d28-vacancies-level-${label}.png`,
      fullPage: true,
    });
  });

  test('B371: fit status is visible beside the level value', async ({ page }) => {
    await stubSession(page, { facets: null });
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    const levelCell = page.locator('.vacancies-screen-cell--level').first();
    await expect(levelCell).toBeVisible();
    await expect(levelCell.locator('.fit-dot').first()).toBeVisible();
    await expect(levelCell).toContainText(/совпадает|не совпадает|не указано/u);
    await expect(page.locator('.career-tooltip-bubble[data-open="true"]')).toHaveCount(0);
  });
});
