import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { captureCareerHarness } from './helpers/capture-career-harness';

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

const MATCHED_VACANCY = {
  cluster: {
    id: 'b156-hh-vacancy',
    canonicalTitle: 'Senior Software Engineer',
    canonicalCompany: 'Example Systems',
    canonicalLocation: 'Москва',
    isRemote: true,
    salary: null,
    descriptionSummary: 'TypeScript и распределённые системы.',
    skills: ['TypeScript', 'Распределённые системы'],
    primaryUrl: 'https://hh.ru/vacancy/15601',
    sources: [
      {
        sourceType: 'hh',
        sourceId: 'b156-hh-vacancy',
        sourceName: 'hh.ru',
        sourceUrl: 'https://hh.ru/vacancy/15601',
        observedAt: '2026-09-28T08:00:00.000Z',
      },
    ],
    firstObservedAt: '2026-09-28T08:00:00.000Z',
    lastSeenAt: '2026-09-28T08:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
  },
  explanation: {
    clusterId: 'b156-hh-vacancy',
    roleMatch: 'target',
    levelMatch: 'match',
    outsideGeography: false,
    matchingPoints: ['TypeScript'],
    missingPoints: [],
    summary: '',
    calculatedAt: '2026-09-28T08:00:00.000Z',
  },
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

async function stubSession(
  page: Page,
  overrides: { subscriptions?: unknown[]; hhAccessClosed?: boolean; failMatched?: boolean } = {},
): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/candidate/matched-vacancies') {
      if (overrides.failMatched) {
        return route.fulfill({
          status: 503,
          json: { error: { code: 'source_unavailable', message: 'Подбор не ответил.' } },
        });
      }
      return route.fulfill({
        json: {
          data: [MATCHED_VACANCY],
          meta: {
            total: 1,
            nextOffset: null,
            campaign: {
              roles: { value: ['Senior Software Engineer'], origin: 'profile' },
              regions: { value: ['ru'], origin: 'profile' },
              remoteOnly: false,
              roleHypotheses: [
                { role: 'Senior Software Engineer', vacancyCount: 1, isHypothesis: false },
              ],
            },
            candidateLevel: 'Senior',
          },
        },
      });
    }
    if (pathname === '/api/v1/auth/me') {
      return route.fulfill({ json: { data: REGISTERED_CANDIDATE } });
    }
    if (pathname === '/api/v1/candidate/me') {
      return route.fulfill({
        json: {
          data: overrides.subscriptions
            ? { ...TEST_SNAPSHOT, vacancySubscriptions: overrides.subscriptions }
            : TEST_SNAPSHOT,
        },
      });
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
              searchCoverage: overrides.hhAccessClosed
                ? 'Публичный поиск закрыт для неавторизованных запросов — вакансии с hh.ru продукт не показывает'
                : 'Публичные вакансии hh.ru',
              health: overrides.hhAccessClosed
                ? {
                    status: 'official_access_required',
                    lastAttemptAt: null,
                    lastSuccessAt: null,
                    lastErrorCode: 'official_access_required',
                    retryAfterAt: null,
                    consecutiveFailures: 0,
                  }
                : { status: 'healthy', checkedAt: '2026-08-19T00:00:00.000Z' },
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
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/, { timeout: 10_000 });
  // Рельс несёт кнопку «Вакансии»; на мобильном она же в нижней панели.
  // `:visible` выбирает ту, что видна в данном вьюпорте.
  await page.locator('button[aria-label="Вакансии"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Вакансии', exact: true })).toBeVisible();
}

test.describe('B156 truthful market intelligence boundary', () => {
  test('candidate sees the Vacancies screen without fabricated outcomes', async ({
    page,
  }, testInfo) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    await openOpportunities(page);

    await page.screenshot({
      path: testInfo.outputPath('vacancies-screen.png'),
      fullPage: true,
    });
    await captureCareerHarness(page, testInfo.outputPath('vacancies-screen.html'));

    // Экран показывает реальную вакансию и её источник; исходы отклика не выводятся.
    await expect(page.getByRole('heading', { name: 'Вакансии', exact: true })).toBeVisible();
    const vacancy = page.locator('.vac-list-item').first();
    await expect(vacancy).toContainText('Senior Software Engineer');
    await vacancy.locator('button').click();
    const detail = page.locator('.vacancies-detail-panel');
    await expect(detail).toContainText('Опубликована на hh.ru');

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

    const accessibility = await new AxeBuilder({ page }).include('.vacancies-screen').analyze();
    const criticalViolations = accessibility.violations.filter((v) => v.impact === 'critical');
    expect(criticalViolations).toEqual([]);
  });

  test('the hh.ru access refusal is named honestly when vacancy loading fails', async ({
    page,
  }) => {
    await stubSession(page, {
      subscriptions: [],
      hhAccessClosed: true,
      failMatched: true,
    });
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    await openOpportunities(page);

    const error = page.locator('.vacancies-state');
    await expect(error).toContainText('Поиск hh.ru без официального доступа недоступен');
    await expect(error).toContainText('Вакансии общего подбора могут поступать');
    await expect(error).not.toContainText('не проверяли');
  });
});
