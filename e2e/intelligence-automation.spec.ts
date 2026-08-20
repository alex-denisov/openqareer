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
    if (pathname === '/api/v1/candidate/account') {
      return route.fulfill({ json: { data: TEST_ACCOUNT } });
    }
    if (pathname === '/api/v1/candidate/connections') {
      return route.fulfill({ json: { data: [] } });
    }
    if (pathname === '/api/v1/vacancies/sources') {
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

test.describe('B145 & B146 Intelligence Panel, Auto-Bumper, Job-Fit and Skill Quizzes', () => {
  test('candidate can interact with auto-bumper, CRM funnel, and view job-fit screening', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    // Market intelligence lives in «Возможности» since B148 §9; «Сегодня» only
    // recommends the next step.
    await openOpportunities(page);

    // 1. Check Auto-Bumper (B145)
    const bumperSection = page.getByRole('heading', { name: /Авто-поднятие резюме/ });
    await expect(bumperSection).toBeVisible();
    await expect(page.getByText('Активен', { exact: true }).first()).toBeVisible();

    const instantBumpButton = page.getByRole('button', { name: /Поднять сейчас/ });
    await expect(instantBumpButton).toBeVisible();
    await instantBumpButton.click();
    await expect(page.getByText(/Сегодня: 19/)).toBeVisible();
    await expect(page.getByText(/Статус: Успешно/)).toBeVisible();

    // 2. Check CRM Funnel (B145)
    await expect(page.getByText('Воронка откликов (CRM)')).toBeVisible();
    await expect(page.getByRole('heading', { name: /откликов отправлено/ })).toBeVisible();
    await expect(page.getByText('Просмотрено', { exact: true })).toBeVisible();
    await expect(page.getByText('Интервью', { exact: true })).toBeVisible();
    await expect(page.getByText('Конверсия', { exact: true })).toBeVisible();

    // 3. Check Job-Fit & Skill Gaps Matrix (B146)
    await expect(page.getByText('Job-Fit & Скрининг вакансии')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Индекс соответствия/ })).toBeVisible();
    await expect(page.getByText('Hard Skills')).toBeVisible();
    await expect(page.getByText('Soft Skills')).toBeVisible();
    await expect(page.getByText('ATS Скоринг')).toBeVisible();
    await expect(page.getByText(/Рекомендация Google XYZ:/)).toBeVisible();

    // 4. Accessibility check
    const accessibility = await new AxeBuilder({ page })
      .include('.career-intelligence-panel')
      .analyze();
    const criticalViolations = accessibility.violations.filter((v) => v.impact === 'critical');
    expect(criticalViolations).toEqual([]);
  });

  test('candidate can launch skill quiz simulator, pass TypeScript quiz and earn verified badge (B146)', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    await openOpportunities(page);

    // Launch Skill Verification Quiz
    const launchQuizBtn = page.getByRole('button', {
      name: 'Начать верификацию навыков hh.ru',
    });
    await expect(launchQuizBtn).toBeVisible();
    await launchQuizBtn.click();

    // Verify Quiz Modal opens
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: 'Верификация навыков hh.ru' })).toBeVisible();
    await expect(modal.getByText('TypeScript')).toBeVisible();

    // Start TypeScript Quiz
    await modal.getByRole('button', { name: 'Начать тест' }).first().click();

    // Answer Question 1
    await expect(modal.getByText(/Вопрос 1 из 4/)).toBeVisible();
    await modal.getByRole('button', { name: /объявить переменную типа/ }).click();
    await modal.getByRole('button', { name: 'Далее' }).click();

    // Answer Question 2
    await expect(modal.getByText(/Вопрос 2 из 4/)).toBeVisible();
    await modal.getByRole('button', { name: /типобезопасным аналогом/ }).click();
    await modal.getByRole('button', { name: 'Далее' }).click();

    // Answer Question 3
    await expect(modal.getByText(/Вопрос 3 из 4/)).toBeVisible();
    await modal.getByRole('button', { name: /Опциональные свойства/ }).click();
    await modal.getByRole('button', { name: 'Далее' }).click();

    // Answer Question 4 & Complete
    await expect(modal.getByText(/Вопрос 4 из 4/)).toBeVisible();
    await modal.getByRole('button', { name: /keyof A \| keyof B/ }).click();
    await modal.getByRole('button', { name: 'Завершить тест' }).click();

    // Result & Badge Check
    await expect(modal.getByText('Тест успешно пройден!')).toBeVisible();
    await expect(modal.getByText('Подтвержденный навык TypeScript (hh.ru)')).toBeVisible();
    await expect(modal.getByText('Разбор ответов:')).toBeVisible();

    // Complete / Close Modal
    await modal.getByRole('button', { name: 'Готово' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Assert Badge is displayed in the Career Intelligence Panel
    await expect(page.getByText('Подтвержденный навык TypeScript (hh.ru)')).toBeVisible();
  });
});
