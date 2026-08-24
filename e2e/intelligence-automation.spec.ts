import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const REGISTERED_CANDIDATE = {
  username: 'intelligence.candidate',
  email: 'intelligence.candidate@example.com',
  displayName: 'Инженер Диагностики',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-b145-b146',
};

const TEST_ACCOUNT = {
  username: 'intelligence.candidate',
  email: 'intelligence.candidate@example.com',
  displayName: 'Инженер Диагностики',
  profile: {
    headline: 'Senior Software Engineer',
    location: 'Москва',
    workMode: 'remote' as const,
    updatedAt: '2026-08-18T12:00:00.000Z',
  },
  sessions: [],
};

const TEST_SNAPSHOT = {
  candidate: {
    id: 'candidate-b145-b146',
    dataClass: 'synthetic',
    locale: 'ru-RU',
    createdAt: '2026-08-18T12:00:00.000Z',
  },
  messages: [],
  memory: [],
  turns: [],
  dossier: {
    sections: [],
    confirmedCount: 2,
    proposedCount: 1,
    readiness: { complete: true, unresolvedQuestions: 0, checks: [] },
  },
  documents: [],
  assessments: [],
  germanyMarket: null,
  vacancySubscriptions: [
    {
      id: 'sub-hh-1',
      candidateId: 'candidate-b145-b146',
      source: 'hh' as const,
      query: 'Senior Software Engineer',
      cadenceMinutes: 240,
      status: 'active' as const,
      createdAt: '2026-08-18T12:00:00.000Z',
      updatedAt: '2026-08-18T12:00:00.000Z',
      analytics: {
        sampleSize: 12,
        sourceFound: 45,
        salaryKnown: 8,
        unknownSalary: 4,
        currencies: [{ currency: 'RUR', medianFrom: 350000, medianTo: 450000 }],
        topLocations: [{ location: 'Москва / Remote', count: 12 }],
        observedFrom: '2026-08-10',
        observedTo: '2026-08-19',
      },
    },
  ],
};

async function stubSession(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/auth/me') {
      return route.fulfill({ json: { data: REGISTERED_CANDIDATE } });
    }
    if (pathname === '/api/v1/candidate/me') {
      return route.fulfill({ json: { data: TEST_SNAPSHOT } });
    }
    if (pathname === '/api/v1/account') {
      return route.fulfill({ json: { data: TEST_ACCOUNT } });
    }
    if (pathname === '/api/v1/candidate/connections') {
      return route.fulfill({ json: { data: [] } });
    }
    if (pathname === '/api/v1/candidate/vacancy-sources') {
      return route.fulfill({
        json: {
          data: [
            {
              id: 'hh',
              name: 'hh.ru',
              market: 'Россия и СНГ',
              attributionUrl: 'https://hh.ru',
              searchCoverage: 'Публичные вакансии hh.ru',
              health: { status: 'healthy', checkedAt: '2026-08-19T00:00:00.000Z' },
            },
          ],
        },
      });
    }
    if (pathname.startsWith('/api/v1/candidate/vacancy-subscriptions')) {
      return route.fulfill({
        json: {
          data: {
            subscription: TEST_SNAPSHOT.vacancySubscriptions[0],
            vacancies: [
              {
                id: 'hh-vac-1',
                title: 'Senior / Lead Engineer',
                company: 'Технологическая Группа',
                location: 'Москва',
                sourceUrl: 'https://hh.ru/vacancy/1',
                publishedAt: '2026-08-18T10:00:00.000Z',
              },
            ],
          },
        },
      });
    }
    return route.fulfill({ json: { data: null } });
  });
}

async function waitForLiveApp(page: Page): Promise<void> {
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
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
      candidateId: REGISTERED_CANDIDATE.candidateId,
      workspace: {
        version: 6,
        createdAt: '2026-08-18T12:00:00.000Z',
        updatedAt: '2026-08-18T12:00:00.000Z',
        resumeText:
          'Senior Software Engineer / Tech Lead with 8+ years experience in TypeScript, React, Node.js and distributed systems architecture.',
        resumeSource: 'text',
        targetDirection: 'Senior Software Engineer',
        market: 'ru',
        currentSituation:
          'Ищу работу ведущим инженером или техлидом в аккредитованной технологической компании.',
        constraints: 'Remote / Hybrid',
        urgency: 'active',
        outcomes: [],
      },
    },
  );
}

async function openOpportunities(page: Page): Promise<void> {
  // The rail is hidden on a phone, where the same navigation lives in the
  // bottom bar; `:visible` picks whichever one this viewport shows.
  await page.locator('button[aria-label="Возможности"]:visible').first().click();
  await expect(page.locator('.career-intelligence-panel')).toBeVisible();
}

test.describe('B156 truthful market intelligence boundary', () => {
  test('candidate sees the source-backed vacancy search without fabricated outcomes', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    // Market intelligence lives in «Возможности» since B148 §9; «Сегодня» only
    // recommends the next step.
    await openOpportunities(page);

    const marketSearch = page.locator('.career-market-watch').filter({
      has: page.getByRole('heading', { name: '12 вакансий в выборке' }),
    });
    await expect(marketSearch).toBeVisible();
    await expect(marketSearch.getByText('Senior Software Engineer', { exact: true })).toBeVisible();
    const vacancy = marketSearch.getByRole('link', { name: /Senior \/ Lead Engineer/ });
    await expect(vacancy).toBeVisible();
    await expect(vacancy).toHaveAttribute('href', 'https://hh.ru/vacancy/1');
    await expect(marketSearch.getByRole('link', { name: 'Источник: hh.ru' })).toBeVisible();
    await expect(marketSearch.getByRole('button', { name: 'Обновить выборку' })).toBeVisible();
    await expect(
      marketSearch.getByRole('button', { name: 'Поставить поиск на паузу' }),
    ).toBeVisible();
    await expect(
      marketSearch.getByRole('button', { name: 'Удалить поисковое направление' }),
    ).toBeVisible();

    for (const fabricatedOutcome of [
      'Авто-поднятие резюме',
      'Поднять сейчас',
      'Воронка откликов (CRM)',
      'Job-Fit & Скрининг вакансии',
      'Индекс соответствия',
      'Начать верификацию навыков hh.ru',
      'Подтвержденный навык TypeScript (hh.ru)',
    ]) {
      await expect(page.getByText(fabricatedOutcome, { exact: false })).toHaveCount(0);
    }

    const accessibility = await new AxeBuilder({ page })
      .include('.career-intelligence-panel')
      .analyze();
    const criticalViolations = accessibility.violations.filter((v) => v.impact === 'critical');
    expect(criticalViolations).toEqual([]);
  });
});
