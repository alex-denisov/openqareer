import { expect, test, type Page } from '@playwright/test';
import { captureCareerHarness } from './helpers/capture-career-harness';

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
  memory: [
    {
      id: 'today-profile-responsibility',
      statement: 'Руководил технологическими операциями в четырёх странах.',
      kind: 'fact' as const,
      domain: 'responsibility' as const,
      status: 'confirmed' as const,
      sourceMessageIds: ['today-profile-1'],
    },
    {
      id: 'today-profile-outcome',
      statement: 'Сократил операционные затраты на 18 процентов.',
      kind: 'fact' as const,
      domain: 'outcome' as const,
      status: 'confirmed' as const,
      sourceMessageIds: ['today-profile-2'],
    },
    {
      id: 'today-profile-team',
      statement: 'Руководил командой из 40 специалистов.',
      kind: 'fact' as const,
      domain: 'role-evidence' as const,
      status: 'confirmed' as const,
      sourceMessageIds: ['today-profile-3'],
    },
  ],
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

const TODAY_NEXT_INTERVIEW_AT = new Date(Date.now() + 48 * 60 * 60 * 1_000).toISOString();

const TODAY_SNAPSHOT = {
  digest: {
    waitingForYou: 2,
    newVacancies: 12,
    followUpsDueToday: 1,
    followUpsOverdue: 1,
    closedVacancies: 2,
    interviewsAhead: 1,
    nextInterview: {
      company: 'HRTx Inc.',
      title: 'Enterprise Architect Director',
      round: 2,
      at: TODAY_NEXT_INTERVIEW_AT,
    },
    newVacanciesCaption: {
      campaignRole: 'VP Technology Ops',
      sourcesCount: 3,
      updatedAt: '2026-09-23T09:14:00.000Z',
    },
    followUpCaptions: ['Peraton — 6 дней тишины'],
  },
  queue: [
    {
      kind: 'follow_up',
      applicationId: 'app-1',
      title: 'Enterprise Architect, Senior Advisor',
      company: 'Peraton',
      eyebrow: 'Follow-up · 6 дней без ответа',
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
      fit: { role: 'target', level: 'match', geo: true },
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
      fit: { role: 'target', level: 'match', geo: false },
    },
    {
      kind: 'interview',
      applicationId: 'app-2',
      title: 'Enterprise Architect Director, раунд 2',
      company: 'HRTx Inc.',
      eyebrow: 'Интервью через 2 дня',
      dueAt: TODAY_NEXT_INTERVIEW_AT,
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
  vacanciesPending: false,
};

function todayApplication(
  id: string,
  company: string,
  title: string,
  stage: 'applied' | 'responded' | 'interview',
  nearestInterview: {
    id: string;
    scheduledAt: string;
    prepStatus: string;
    round: number;
  } | null = null,
) {
  return {
    id,
    candidateId: CANDIDATE.candidateId,
    clusterId: null,
    stage,
    closedReason: null,
    processProfile: 'standard',
    vacancy: {
      title,
      company,
      companyHidden: false,
      url: 'https://example.com/application',
      source: 'hh',
    },
    notes: null,
    followUpDueAt: stage === 'applied' || stage === 'responded' ? TODAY_NEXT_INTERVIEW_AT : null,
    stageChangedAt: '2026-09-20T10:00:00.000Z',
    version: 1,
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview,
  };
}

const TODAY_TRACKER_APPLICATIONS = [
  todayApplication('app-1', 'Peraton', 'Enterprise Architect, Senior Advisor', 'applied'),
  todayApplication('app-3', 'Genetec', 'Enterprise Architect', 'responded'),
  todayApplication('app-2', 'HRTx Inc.', 'Enterprise Architect Director', 'interview', {
    id: 'interview-1',
    scheduledAt: TODAY_NEXT_INTERVIEW_AT,
    prepStatus: 'not_started',
    round: 2,
  }),
];

const PENDING_TODAY_SNAPSHOT = { ...TODAY_SNAPSHOT, vacanciesPending: true };

const TODAY_MATCHED_VACANCIES = Array.from({ length: 12 }, (_, index) => {
  const id = `today-vacancy-${index + 1}`;
  return {
    cluster: {
      id,
      canonicalTitle: 'VP Technology Operations',
      canonicalCompany: `Operations Group ${index + 1}`,
      canonicalLocation: 'Dubai',
      isRemote: true,
      descriptionSummary: 'Regional technology operations leadership role.',
      skills: ['Technology operations', 'P&L'],
      primaryUrl: `https://example.com/vacancies/${index + 1}`,
      sources: [
        {
          sourceType: 'remotive',
          sourceId: id,
          sourceUrl: `https://example.com/vacancies/${index + 1}`,
          observedAt: '2026-09-23T09:14:00.000Z',
        },
      ],
      firstObservedAt: '2026-09-23T09:14:00.000Z',
      lastSeenAt: '2026-09-27T08:00:00.000Z',
      status: 'active' as const,
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: id,
      roleMatch: 'target' as const,
      levelMatch: 'match' as const,
      outsideGeography: false,
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: '2026-09-27T08:00:00.000Z',
    },
  };
});

const EMPTY_TODAY_SNAPSHOT = {
  ...TODAY_SNAPSHOT,
  digest: {
    ...TODAY_SNAPSHOT.digest,
    waitingForYou: 0,
    newVacancies: 0,
    followUpsDueToday: 0,
    followUpsOverdue: 0,
    closedVacancies: 0,
    interviewsAhead: 0,
    nextInterview: null,
    newVacanciesCaption: null,
    followUpCaptions: [],
  },
  queue: [],
  followUps: [],
  sinceLastVisit: { since: '2026-09-23T08:00:00.000Z', items: [] },
  vacanciesPending: false,
};

async function stubSession(page: Page, todaySnapshot = TODAY_SNAPSHOT): Promise<void> {
  let followUpSent = false;
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
          data: TODAY_MATCHED_VACANCIES,
          meta: {
            total: TODAY_MATCHED_VACANCIES.length,
            nextOffset: null,
            campaign: {
              roles: { value: ['VP Technology Ops'], origin: 'explicit' },
              regions: { value: ['mena', 'eu'], origin: 'explicit' },
              remoteOnly: false,
            },
            candidateLevel: 'VP / C-level',
          },
        },
      });
    }
    if (request.method() === 'GET' && pathname === '/api/v1/candidate/applications') {
      return route.fulfill({ json: { data: TODAY_TRACKER_APPLICATIONS } });
    }
    if (request.method() === 'POST' && pathname === '/api/v1/candidate/visits') {
      return route.fulfill({ json: { data: { since: todaySnapshot.sinceLastVisit.since } } });
    }
    if (request.method() === 'POST' && pathname === '/api/v1/candidate/applications/app-1/events') {
      followUpSent = true;
      return route.fulfill({ json: { data: { id: 'app-1' } } });
    }
    if (pathname === '/api/v1/candidate/today') {
      const data = followUpSent
        ? {
            ...todaySnapshot,
            digest: { ...todaySnapshot.digest, followUpsDueToday: 0, followUpCaptions: [] },
            queue: todaySnapshot.queue.filter(
              (item: { kind: string }) => item.kind !== 'follow_up',
            ),
            followUps: [],
          }
        : todaySnapshot;
      return route.fulfill({ json: { data } });
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
  }, testInfo) => {
    await stubSession(page, PENDING_TODAY_SNAPSHOT);
    await seedWorkspace(page);
    await openApp(page);

    await expect(page.locator('.career-path-step').nth(0)).toHaveAttribute('data-state', 'done');
    await expect(page.locator('.career-path-step[data-state="active"]')).toHaveCount(0);
    const responseStep = page.locator('.career-path-step').nth(3);
    await expect(responseStep).toHaveAttribute('data-status', 'in-progress');
    await expect(responseStep).toContainText('3 в работе');
    const interviewStep = page.locator('.career-path-step').nth(4);
    await expect(interviewStep).toHaveAttribute('data-status', 'in-progress');
    await expect(interviewStep).toContainText('HRTx Inc.');

    await expect(page.locator('.career-page-header h1')).toHaveText('Сегодня');
    await expect(page.locator('.career-today-digest')).toContainText('12');
    await expect(page.locator('.career-today-digest')).toContainText(
      'follow-up назначено на сегодня',
    );
    await expect(page.locator('.career-today-digest')).toContainText('HRTx Inc.');

    const rows = page.locator('.career-today-item');
    // 1 consultant action + 4 queue items = 5 items
    await expect(rows).toHaveCount(5);
    const consultantCard = rows.first();
    await expect(consultantCard).toHaveClass(/is-first/);
    await expect(consultantCard).toHaveClass(/career-today-consultant-card/);
    await expect(consultantCard).toContainText('Консультант · Один шаг на сегодня');
    await expect(consultantCard).toContainText('Что изменится:');
    await expect(consultantCard.locator('.career-today-consultant-action')).toBeVisible();
    await expect(consultantCard.locator('.career-today-consultant-dismiss')).toBeVisible();

    const secondRow = rows.nth(1);
    await expect(secondRow).not.toHaveClass(/is-first/);
    await expect(secondRow).toContainText('Peraton');
    await expect(page.locator('body')).not.toContainText('Следующее действие');

    await expect(page.locator('.career-today-followups')).toContainText('Follow-up по срокам');
    await expect(page.locator('.career-today-since-hint')).toContainText(
      'Genetec запросили доступность на этой неделе',
    );
    await expect(page.locator('.career-today-since')).toHaveCount(0);
    await expect(page.locator('.career-today-pending')).toContainText('Считаем вашу подборку');
    const sentFollowUp = page.locator('.career-today-followups li').filter({ hasText: 'HRTx' });
    await expect(sentFollowUp.getByRole('button')).toHaveCount(0);
    await captureCareerHarness(page, testInfo.outputPath('today-screen.html'));
  });

  test('marks a follow-up as sent from the day queue and removes it after refresh', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await openApp(page);

    await page.getByRole('button', { name: 'Отметить отправленным' }).first().click();
    await expect(page.getByRole('button', { name: 'Отметить отправленным' })).toHaveCount(0);
    await expect(page.locator('.career-today-followups')).toHaveCount(0);
  });

  test('the screen fits 1440 and 390 with no horizontal overflow', async ({ page }, testInfo) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);

    const wideOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(wideOverflow).toBeLessThanOrEqual(0);
    const wideDigestColumns = await page
      .locator('.career-today-digest')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(wideDigestColumns).toBe(4);
    await expect(page.locator('.career-today-consultant-card')).toBeVisible();
    await page.screenshot({
      path: process.env.SHOTS_DIR
        ? `${process.env.SHOTS_DIR}/today-1440.png`
        : 'output/playwright/C57/today-1440.png',
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.career-today')).toBeVisible();
    await expect(page.locator('.career-path-step').nth(0)).toHaveAttribute('data-state', 'done');
    await expect(page.locator('.career-path-step[data-state="active"]')).toHaveCount(0);

    const digestColumns = await page
      .locator('.career-today-digest')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(digestColumns).toBe(2);
    await expect(page.locator('.career-today-consultant-card')).toBeVisible();
    const narrowOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(narrowOverflow).toBeLessThanOrEqual(0);
    await page.addStyleTag({
      content: `.career-mobile-nav { position: static !important; }`,
    });
    await page.screenshot({
      path: process.env.SHOTS_DIR
        ? `${process.env.SHOTS_DIR}/today-390.png`
        : 'output/playwright/C57/today-390.png',
      fullPage: true,
    });

    void testInfo;
  });

  test('explains the next step with an honest empty queue', async ({ page }) => {
    await stubSession(page, EMPTY_TODAY_SNAPSHOT);
    await seedWorkspace(page);
    await openApp(page);

    await expect(page.locator('.career-today-digest')).toContainText('0');
    await expect(page.locator('.career-today-since')).toHaveCount(0);
    await expect(page.locator('.career-today-since-hint')).toHaveCount(0);
    // Consultant proposal is shown initially even with an empty queue
    await expect(page.locator('.career-today-consultant-card')).toBeVisible();
    await expect(page.locator('.career-today-empty')).toHaveCount(0);

    // After dismissing the proposal, the honest empty queue message appears
    await page.locator('.career-today-consultant-dismiss').click();
    await expect(page.locator('.career-today-consultant-card')).toHaveCount(0);
    await expect(page.locator('.career-today-empty')).toContainText(
      'Новые вакансии появятся здесь сами.',
    );
  });

  test('consultant action button navigates to target view without opening drawer', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await openApp(page);

    const consultantCard = page.locator('.career-today-consultant-card');
    await expect(consultantCard).toBeVisible();

    // Click primary action button on consultant card
    await consultantCard.locator('.career-today-consultant-action').click();

    // Navigates to target section (e.g. Profile)
    await expect(page.locator('.career-page-header h1')).toHaveText('Профиль');
    // Does NOT open the expert panel / chat drawer
    await expect(page.locator('.career-drawer')).toHaveCount(0);
    await expect(page.locator('.career-expert-panel')).toHaveCount(0);

    // Return to Today view
    await page.locator('.career-nav-button:visible').filter({ hasText: 'Сегодня' }).click();
    await expect(page.locator('.career-page-header h1')).toHaveText('Сегодня');
    // Resolved proposal does not return
    await expect(page.locator('.career-today-consultant-card')).toHaveCount(0);
  });

  test('displays returning-user banner on second visit, navigates on click and matches 1440/390 (B255)', async ({
    page,
  }) => {
    let visitCount = 0;
    const FIRST_VISIT_SNAPSHOT = {
      ...TODAY_SNAPSHOT,
      sinceLastVisit: {
        since: null,
        items: [],
      },
    };

    const SECOND_VISIT_SNAPSHOT = {
      ...TODAY_SNAPSHOT,
      digest: {
        ...TODAY_SNAPSHOT.digest,
        newVacancies: 3,
        applicationsWaitingOver7Days: 1,
        nextInterview: {
          company: 'HRTx Inc.',
          title: 'Enterprise Architect Director',
          round: 2,
          at: TODAY_NEXT_INTERVIEW_AT,
        },
      },
      sinceLastVisit: {
        since: '2026-09-24T10:00:00.000Z',
        items: ['3 новые вакансии по VP Technology Ops'],
        newVacanciesCount: 3,
        applicationsWaitingOver7Days: 1,
        nearestInterview: {
          company: 'HRTx Inc.',
          title: 'Enterprise Architect Director',
          round: 2,
          at: TODAY_NEXT_INTERVIEW_AT,
        },
      },
    };

    await stubSession(page, FIRST_VISIT_SNAPSHOT);
    await seedWorkspace(page);

    await page.route('**/api/v1/candidate/today*', async (route) => {
      const data = visitCount === 0 ? FIRST_VISIT_SNAPSHOT : SECOND_VISIT_SNAPSHOT;
      return route.fulfill({ json: { data } });
    });

    // Visit 1: Desktop 1440
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await expect(page.locator('.career-today-return-banner')).toHaveCount(0);
    await page.screenshot({ path: 'output/playwright/B255/visit-1-1440.png', fullPage: true });

    // Visit 1: Mobile 390
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.career-today-return-banner')).toHaveCount(0);
    await page.screenshot({ path: 'output/playwright/B255/visit-1-390.png', fullPage: true });

    // Advance to Visit 2
    visitCount = 1;

    // Navigate to Profile and back to Today
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.career-nav-button:visible').filter({ hasText: 'Профиль' }).click();
    await expect(page.locator('.career-page-header h1')).toHaveText('Профиль');

    // Return to Today (Visit 2)
    await page.locator('.career-nav-button:visible').filter({ hasText: 'Сегодня' }).click();
    await expect(page.locator('.career-page-header h1')).toHaveText('Сегодня');

    // Visit 2: Banner must be visible with all 3 items
    const banner = page.locator('.career-today-return-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('С прошлого визита:');
    await expect(banner.locator('[data-testid="since-visit-vacancies"]')).toHaveText(
      '3 новые подходящие вакансии',
    );
    await expect(banner.locator('[data-testid="since-visit-applications"]')).toHaveText(
      '1 отклик ждёт ответа больше 7 дней',
    );
    await expect(banner.locator('[data-testid="since-visit-interview"]')).toContainText(
      'ближайшее интервью',
    );
    await page.screenshot({ path: 'output/playwright/B255/visit-2-1440.png', fullPage: true });

    // Check responsive layout on 390
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(banner).toBeVisible();
    const narrowOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(narrowOverflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: 'output/playwright/B255/visit-2-390.png', fullPage: true });

    // Test Navigation: click vacancies link in banner
    await banner.locator('[data-testid="since-visit-vacancies"]').click();
    await expect(page.locator('.career-page-header h1')).toHaveText('Вакансии');

    // Return to Today and click applications link in banner
    await page.locator('.career-nav-button:visible').filter({ hasText: 'Сегодня' }).click();
    await expect(page.locator('.career-page-header h1')).toHaveText('Сегодня');
    await expect(banner).toBeVisible();

    await banner.locator('[data-testid="since-visit-applications"]').click();
    await expect(page.locator('.career-page-header h1')).toHaveText('Отклики');

    // Return to Today and click interview link in banner
    await page.locator('.career-nav-button:visible').filter({ hasText: 'Сегодня' }).click();
    await expect(page.locator('.career-page-header h1')).toHaveText('Сегодня');
    await expect(banner).toBeVisible();

    await banner.locator('[data-testid="since-visit-interview"]').click();
    await expect(page.locator('.career-page-header h1')).toHaveText('Отклики');
  });

  test('B344 D10: карточка очереди показывает «Компания не указана — Должность» вместо ФИО рекрутёра', async ({
    page,
  }) => {
    const customSnapshot = {
      ...TODAY_SNAPSHOT,
      queue: [
        {
          kind: 'new_vacancy' as const,
          clusterId: 'cl-recruiter',
          title: 'Head of Engineering',
          company: 'Глушкова Ксения Евгеньевна',
          eyebrow: 'сегодня',
          dueAt: null,
          salary: null,
          location: 'Москва',
          fit: null,
        },
      ],
    };

    await page.setViewportSize({ width: 1176, height: 900 });
    await stubSession(page, customSnapshot);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    const queueItem = page
      .locator('.career-today-item:not([data-testid="consultant-queue-card"])')
      .first();
    const titleEl = queueItem.locator('.career-today-item-title');
    await expect(titleEl).toHaveText('Компания не указана — Head of Engineering');
    await expect(titleEl).not.toContainText('Глушкова');

    const logoEl = queueItem.locator('.career-today-item-logo');
    await expect(logoEl).toHaveText('—');

    await page.screenshot({ path: 'output/playwright/B344/d10-today-queue-1176.png' });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(titleEl).toHaveText('Компания не указана — Head of Engineering');
    await page.screenshot({ path: 'output/playwright/B344/d10-today-queue-390.png' });
  });
});
