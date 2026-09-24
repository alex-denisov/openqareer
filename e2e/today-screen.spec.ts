import { expect, test, type Page } from '@playwright/test';

/**
 * B251 S5 — «Сегодня»: дайджест дня и очередь решений, подключённые вместо
 * старого CareerHome (макет B248/today.html). Проверяет, что экран
 * действительно показывается по умолчанию, первая строка очереди выделена
 * как следующее действие, и «подбор обновляется» не переполняет вьюпорт.
 */

const CANDIDATE = {
  username: 'today.candidate',
  email: 'today.candidate@example.com',
  displayName: 'Кандидат Сегодня',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-b251',
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

const TODAY_SNAPSHOT = {
  digest: {
    waitingForYou: 2,
    newVacancies: 12,
    closedVacancies: 2,
    interviewsAhead: 1,
    nextInterview: {
      company: 'HRTx Inc.',
      title: 'Enterprise Architect Director',
      round: 2,
      at: '2026-09-26T14:00:00.000Z',
    },
    newVacanciesCaption: {
      campaignRole: 'VP Technology Ops',
      sourcesCount: 3,
      updatedAt: '2026-09-23T09:14:00.000Z',
    },
    followUpCaptions: ['Peraton — 6 рабочих дней тишины', 'Genetec — обещанный срок истёк'],
  },
  queue: [
    {
      kind: 'follow_up',
      applicationId: 'app-1',
      title: 'Enterprise Architect, Senior Advisor',
      company: 'Peraton',
      eyebrow: 'Follow-up · 6 рабочих дней без ответа',
      dueAt: '2026-09-23T00:00:00.000Z',
      salary: { from: 176000, currency: 'usd' },
      fit: null,
    },
    {
      kind: 'new_vacancy',
      clusterId: 'cl-1',
      title: 'Business Information Architect',
      company: 'Genetec',
      eyebrow: 'Новая вакансия · сегодня',
      dueAt: null,
      salary: { from: 190000, to: 240000, currency: 'usd' },
      location: 'Canada · удалённо',
      fit: { role: 'target', level: 'target', geo: true },
    },
    {
      kind: 'new_vacancy',
      clusterId: 'cl-2',
      title: 'Cloud & Infrastructure Solution Architect',
      company: 'Sonsoft',
      eyebrow: 'Новая вакансия · сегодня',
      dueAt: null,
      salary: { from: 170000, to: 210000, currency: 'usd' },
      location: 'US · релокация',
      fit: { role: 'target', level: 'target', geo: false },
    },
    {
      kind: 'interview',
      applicationId: 'app-2',
      title: 'Enterprise Architect Director, раунд 2',
      company: 'HRTx Inc.',
      eyebrow: 'Интервью через 2 дня',
      dueAt: '2026-09-26T14:00:00.000Z',
      fit: null,
    },
  ],
  followUps: [
    { applicationId: 'app-1', company: 'Peraton', title: 'Enterprise Architect', status: 'today' },
    { applicationId: 'app-3', company: 'Genetec', title: 'обещанный ответ', status: 'overdue' },
    { applicationId: 'app-4', company: 'HRTx', title: 'thank-you после раунда 1', status: 'sent' },
  ],
  sinceLastVisit: {
    since: '2026-09-23T08:00:00.000Z',
    items: [
      '12 новых вакансий по VP Technology Ops, 3 по COO (гипотеза)',
      'Genetec запросили доступность на этой неделе',
      '2 вакансии закрылись без ответа — перенесены в архив',
    ],
  },
  vacanciesPending: true,
};

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
          data: [],
          meta: { total: 0, nextOffset: null, campaign: null, candidateLevel: null },
        },
      });
    }
    if (request.method() === 'POST' && pathname === '/api/v1/candidate/visits') {
      return route.fulfill({ json: { data: { since: TODAY_SNAPSHOT.sinceLastVisit } } });
    }
    if (pathname === '/api/v1/candidate/today') {
      return route.fulfill({ json: { data: TODAY_SNAPSHOT } });
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

async function openApp(page: Page): Promise<void> {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await expect(page.locator('.career-today')).toBeVisible();
}

test.describe('B251 today screen', () => {
  test('shows the digest and the queue with the first row marked as the next action', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await openApp(page);

    await expect(page.locator('.career-cabinet-header h1')).toHaveText('Сегодня');
    await expect(page.locator('.career-today-digest')).toContainText('12');
    await expect(page.locator('.career-today-digest')).toContainText(
      'follow-up просят действия сегодня',
    );
    await expect(page.locator('.career-today-digest')).toContainText('HRTx Inc.');

    const rows = page.locator('.career-today-item');
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toHaveClass(/is-first/);
    await expect(rows.first()).toContainText('Peraton');
    await expect(rows.nth(1)).not.toHaveClass(/is-first/);
    await expect(page.locator('body')).not.toContainText('Следующее действие');

    await expect(page.locator('.career-today-followups')).toContainText('Follow-up по срокам');
    await expect(page.locator('.career-today-since')).toContainText('С прошлого визита');
    await expect(page.locator('.career-today-pending')).toContainText('Подбор обновляется');
  });

  test('the screen fits 1440 and 390 with no horizontal overflow', async ({ page }, testInfo) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);

    const wideOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    console.log(
      'DIAG1440 ' +
        JSON.stringify(
          await page.evaluate(() => {
            const cw = document.documentElement.clientWidth;
            return [...document.querySelectorAll<HTMLElement>('body *')]
              .map((el) => ({ el, r: el.getBoundingClientRect() }))
              .filter(({ r }) => r.width > 0 && r.right > cw + 0.01)
              .slice(0, 15)
              .map(
                ({ el, r }) =>
                  `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 60)} right=${r.right.toFixed(2)} w=${r.width.toFixed(2)} cw=${cw}`,
              );
          }),
          null,
          1,
        ),
    );
    expect(wideOverflow).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: process.env.SHOTS_DIR
        ? `${process.env.SHOTS_DIR}/today-1440.png`
        : testInfo.outputPath('today-1440.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.career-today')).toBeVisible();
    const narrowOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const offenders = await page.evaluate(() => {
      const cw = document.documentElement.clientWidth;
      return [...document.querySelectorAll<HTMLElement>('body *')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.right > cw + 0.01)
        .slice(0, 15)
        .map(
          ({ el, r }) =>
            `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 60)} right=${r.right.toFixed(2)} w=${r.width.toFixed(2)} cw=${cw}`,
        );
    });
    console.log('DIAG ' + JSON.stringify(offenders, null, 1));
    expect(narrowOverflow).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: process.env.SHOTS_DIR
        ? `${process.env.SHOTS_DIR}/today-390.png`
        : testInfo.outputPath('today-390.png'),
      fullPage: true,
    });

    void testInfo;
  });
});
