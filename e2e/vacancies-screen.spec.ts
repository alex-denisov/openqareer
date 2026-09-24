import { expect, test, type Page } from '@playwright/test';

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
  roles: { value: ['VP Technology Ops'], origin: 'profile' },
  regions: { value: ['Дубай', 'Европа'], origin: 'profile' },
  roleHypotheses: [
    { role: 'VP Technology Ops', vacancyCount: 34, isHypothesis: false },
    { role: 'COO', vacancyCount: 6, isHypothesis: true },
    { role: 'Chief of Staff', vacancyCount: 3, isHypothesis: true },
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
    salary: { from: 25000, to: 35000, currency: 'USD', gross: true },
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
    levelMatch: 'target',
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
    cluster: cluster('c-1', 'VP Technology Operations', 'Genetec'),
    explanation: explanation('c-1'),
  },
  {
    cluster: cluster('c-2', 'VP Technology Ops (гипотеза)', 'Careem'),
    explanation: explanation('c-2'),
  },
  {
    cluster: cluster('c-3', 'COO', 'Noon', { canonicalLocation: 'Европа', isRemote: true }),
    explanation: explanation('c-3', { levelMatch: 'related' }),
  },
  {
    cluster: cluster('c-4', 'Chief of Staff', 'Emirates NBD'),
    explanation: explanation('c-4', { outsideGeography: true }),
  },
  {
    cluster: cluster('c-5', 'VP Technology Operations', 'Talabat'),
    explanation: explanation('c-5'),
  },
  {
    cluster: cluster(
      'c-6',
      'Vice President, Technology Operations & Platform Engineering for Emerging Markets',
      'A Very Long Company Name For Overflow Testing LLC',
      { canonicalLocation: 'Дубай, Объединённые Арабские Эмираты' },
    ),
    explanation: explanation('c-6'),
  },
];

async function stubSession(page: Page): Promise<void> {
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
    if (pathname === '/api/v1/candidate/matched-vacancies') {
      return route.fulfill({
        json: {
          data: MATCHED_ITEMS,
          meta: {
            total: 61,
            nextOffset: null,
            campaign: CAMPAIGN,
            candidateLevel: 'VP / C-level',
          },
        },
      });
    }
    return route.fulfill({ json: { data: null } });
  });
}

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
      },
    },
  );
}

async function openVacancies(page: Page): Promise<void> {
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await page.locator('button[aria-label="Вакансии"]:visible').first().click();
  await expect(page.locator('.vacancies-screen')).toBeVisible();
}

test.describe('B250 vacancies screen', () => {
  test('shows the campaign banner, role hypotheses, level and pool rows', async ({ page }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openVacancies(page);

    await expect(page.locator('.vacancies-screen h1')).toHaveText('Вакансии');
    await expect(page.locator('.career-eyebrow')).toContainText('VP Technology Ops');

    const filters = page.locator('.vacancies-filters');
    await expect(filters.getByText('VP Technology Ops (34)')).toBeVisible();
    await expect(filters.getByText(/COO \(6\).*гипотеза/)).toBeVisible();
    await expect(filters.getByText(/Chief of Staff \(3\).*гипотеза/)).toBeVisible();
    await expect(filters.getByText('VP / C-level')).toBeVisible();

    const listHead = page.locator('.vacancies-list-head');
    await expect(listHead).toContainText('61 вакансий');

    // The default role chip is the primary campaign role, so the list starts
    // filtered to the titles that match it — the same rule the server used
    // to count the chip (B248).
    const rows = page.locator('.vac-list-item');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('VP Technology Operations');
    await expect(rows.first()).toContainText('Genetec');

    await rows.first().locator('.vac-row').click();
    await expect(rows.first().locator('.vac-row')).toHaveAttribute('aria-pressed', 'true');

    await filters.getByText(/COO \(6\).*гипотеза/).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Noon');
  });

  test('the screen fits 1440 and 390 with no horizontal overflow', async ({ page }, testInfo) => {
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
      path: '/Users/alexeydenisov/Projects/openqareer/docs/v1-release/tasks/work/B248/impl-shots/vacancies/vacancies-1440.png',
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.vacancies-screen')).toBeVisible();
    const narrowOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(narrowOverflow).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: '/Users/alexeydenisov/Projects/openqareer/docs/v1-release/tasks/work/B248/impl-shots/vacancies/vacancies-390.png',
      fullPage: true,
    });

    void testInfo;
  });
});
