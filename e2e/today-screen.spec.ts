import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { captureCareerHarness } from './helpers/capture-career-harness';
import { waitForCareerShell } from './helpers/waitForCareerShell';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';

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
const S10_EVIDENCE_DIR = e2eEvidenceDirectory('S10-VIS');

test.beforeAll(() => mkdirSync(S10_EVIDENCE_DIR, { recursive: true }));

async function captureS10Today(page: Page, name: string): Promise<void> {
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

interface LinkedinStopStatusFixture {
  readonly paused: boolean;
  readonly reason: string | null;
  readonly canResume: boolean;
  readonly updatedAt: string | null;
}

const LINKEDIN_STOP_STATUS: LinkedinStopStatusFixture = {
  paused: true,
  reason: 'platform_restricted' as const,
  canResume: true,
  updatedAt: '2026-10-06T10:00:00.000Z',
};
const LINKEDIN_RESUMED_STATUS: LinkedinStopStatusFixture = {
  paused: false,
  reason: null,
  canResume: false,
  updatedAt: null,
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

async function stubSession(
  page: Page,
  todaySnapshot = TODAY_SNAPSHOT,
  initialLinkedinStatus: LinkedinStopStatusFixture = LINKEDIN_RESUMED_STATUS,
  omitCandidateMemory = false,
): Promise<{ resumeRequest: () => unknown }> {
  let followUpSent = false;
  let linkedinStatus = initialLinkedinStatus;
  let resumeRequest: unknown = null;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
    if (pathname === '/api/v1/candidate/me') {
      const snapshot = omitCandidateMemory ? { ...SNAPSHOT, memory: [] } : SNAPSHOT;
      return route.fulfill({ json: { data: snapshot } });
    }
    if (
      [
        '/api/v1/candidate/me/memory',
        '/api/v1/candidate/me/turns',
        '/api/v1/candidate/me/messages',
      ].includes(pathname)
    ) {
      return route.fulfill({ json: { data: [], meta: { nextOffset: null } } });
    }
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
    if (request.method() === 'GET' && pathname === '/api/v1/candidate/actions/usage') {
      return route.fulfill({ json: { data: { linkedinSafetyStop: linkedinStatus } } });
    }
    if (request.method() === 'POST' && pathname === '/api/v1/candidate/actions/kill-switch') {
      resumeRequest = request.postDataJSON();
      linkedinStatus = LINKEDIN_RESUMED_STATUS;
      return route.fulfill({
        json: {
          data: { ok: true, active: false, linkedinSafetyStop: linkedinStatus },
        },
      });
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
  return { resumeRequest: () => resumeRequest };
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

async function seedEmptyWorkspace(page: Page): Promise<void> {
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
        resumeText: '',
        resumeSource: 'text',
        targetDirection: '',
        regions: [],
        currentSituation: 'Пока собираю информацию о подходящей роли.',
        constraints: '',
        urgency: 'active',
        outcomes: [],
      },
    },
  );
}

async function openApp(page: Page): Promise<void> {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await waitForCareerShell(page);
  await expect(page.locator('.career-today')).toBeVisible();
}

test.describe('B251 today screen', () => {
  test('shows the legacy digest and queue on mobile', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Desktop Today uses the S10 layout.');
    await stubSession(page, PENDING_TODAY_SNAPSHOT);
    await seedWorkspace(page);
    await openApp(page);

    await expect(page.locator('.career-today-mobile')).toBeVisible();
    await expect(page.locator('.career-today-return-banner')).toBeVisible();
    await expect(page.locator('.career-today-since-hint')).toContainText(
      'Genetec запросили доступность на этой неделе',
    );
    await expect(page.locator('.career-today-digest')).toBeVisible();
    const queue = page.locator('.career-today-queue');
    await expect(queue.getByRole('listitem')).toHaveCount(5);
    await expect(queue.locator('.career-today-consultant-card')).toContainText(
      'Добавим полный источник',
    );
    await expect(queue).toContainText('Peraton');
    await captureS10Today(page, 'today-390-legacy');
    await captureCareerHarness(page, testInfo.outputPath('today-screen-mobile.html'));
  });

  test('marks a follow-up as sent from the day queue and removes it after refresh', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Desktop queue rows route to Responses.');
    await stubSession(page);
    await seedWorkspace(page);
    await openApp(page);

    const followUp = page
      .locator('.career-today-queue')
      .getByRole('listitem')
      .filter({ hasText: 'Peraton' });
    await expect(followUp).toBeVisible();
    await followUp.click();
    const markSent = followUp.getByRole('button', { name: 'Отметить отправленным' });
    await expect(markSent).toBeVisible();
    await markSent.click();
    await expect(followUp).toHaveCount(0);
  });

  test('B395: shows the LinkedIn stop, then resumes only after a manual candidate action', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'mobile-390',
      'The LinkedIn draft card stays in compact Today.',
    );
    const session = await stubSession(page, TODAY_SNAPSHOT, LINKEDIN_STOP_STATUS);
    await seedWorkspace(page);
    await openApp(page);

    const stop = page.getByRole('status').filter({ hasText: 'Действия LinkedIn приостановлены' });
    await expect(stop).toContainText('LinkedIn ограничил запрос');
    const resumeButton = page.getByRole('button', { name: 'Возобновить вручную' });
    await expect(resumeButton).toBeEnabled();

    const width = page.viewportSize()?.width;
    expect(width).toBe(testInfo.project.name === 'desktop-1440' ? 1440 : 390);
    await stop.scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await captureCareerHarness(
      page,
      testInfo.outputPath(`b395-linkedin-stop-${width}.html`),
      '.career-drafts',
    );
    await captureCareerHarness(page, testInfo.outputPath(`b395-today-${width}.html`));
    await page.screenshot({
      path: testInfo.outputPath(`b395-linkedin-stop-${width}.png`),
      fullPage: true,
    });

    await resumeButton.click();
    await expect(page.getByRole('status').filter({ hasText: 'Пауза снята.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Возобновить вручную' })).toHaveCount(0);
    expect(session.resumeRequest()).toEqual({ active: false, platform: 'linkedin' });
    await page.screenshot({
      path: testInfo.outputPath(`b395-linkedin-resumed-${width}.png`),
      fullPage: true,
    });
  });

  test('S10-VIS: the new Today layout fits 1440 and 390 without horizontal overflow', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Captures both target widths once.');
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);

    const wideOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(wideOverflow).toBeLessThanOrEqual(0);
    await expect(page.locator('.career-today-desktop')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Следующее решение' })).toContainText(
      'Добавим полный источник',
    );
    await expect(page.getByRole('region', { name: 'Очередь дня' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Воронка за 30 дней' })).toBeVisible();
    await captureS10Today(page, 'today-1440');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.career-today-mobile')).toBeVisible();
    await expect(page.locator('.career-today-desktop')).toBeHidden();
    await expect(page.locator('.career-today-digest')).toBeVisible();
    const narrowOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(narrowOverflow).toBeLessThanOrEqual(0);
    await captureS10Today(page, 'today-390');
  });

  test('keeps an empty mobile queue honest when no consultant action exists', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'mobile-390',
      'Desktop has a separate decision empty state.',
    );
    await stubSession(page, EMPTY_TODAY_SNAPSHOT, LINKEDIN_RESUMED_STATUS, true);
    await seedEmptyWorkspace(page);
    await openApp(page);

    const queue = page.locator('.career-today-queue');
    await expect(queue).toContainText(/Решений на сегодня нет/u);
    await expect(page.locator('.career-today-consultant-card')).toHaveCount(0);
  });

  test('an unverified desktop decision opens the consultant without claiming a profile action', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Checks the S10 desktop decision state.');
    await stubSession(page, TODAY_SNAPSHOT, LINKEDIN_RESUMED_STATUS, true);
    await seedEmptyWorkspace(page);
    await openApp(page);

    const nextDecision = page.getByRole('region', { name: 'Следующее решение' });
    await expect(nextDecision).toBeVisible();
    await expect(nextDecision).toContainText('Нет проверенного следующего шага');
    await expect(nextDecision.getByRole('button', { name: 'Подтвердить факт' })).toHaveCount(0);
    await nextDecision.getByRole('button', { name: 'Обсудить', exact: true }).click();
    await expect(page.locator('.career-drawer')).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: /Консультант/u })).toBeVisible();
  });

  test('S10-VIS: the compact Today screen can open the consultant sheet', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'The desktop consultant is already docked.');
    await stubSession(page);
    await seedWorkspace(page);
    await openApp(page);

    const panel = page.locator('.career-expert-panel');
    await page.getByRole('button', { name: 'Спросить консультанта' }).click();
    await expect(page.getByRole('complementary', { name: /Консультант/u })).toBeVisible();
    await expect(page.getByLabel('Сообщение карьерному консультанту')).toBeVisible();
    if ((page.viewportSize()?.width ?? 1440) <= 760) {
      await expect(panel).toHaveAttribute('data-mobile-expanded', 'false');
    }
  });

  test('S10-VIS: returning changes appear in one dismissible notice at 1440 and 390 (B255)', async ({
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
    await expect(page.getByRole('button', { name: 'Смотреть', exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'output/playwright/B255/visit-1-1440.png', fullPage: true });

    // Visit 1: Mobile 390
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Смотреть', exact: true })).toHaveCount(0);
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

    const notice = page.getByRole('button', { name: 'Смотреть', exact: true });
    await expect(notice).toBeVisible();
    const changesStrip = page.locator('.career-today-changes');
    await expect(changesStrip.getByText(/3 новые вакансии по VP Technology Ops/u)).toBeVisible();
    await expect(changesStrip.getByText(/1 отклик ждёт ответа больше 7 дней/u)).toBeVisible();
    await expect(changesStrip.getByText(/HRTx Inc\..*ближайшее интервью/u)).toBeVisible();
    await expect(page.locator('.career-today-mobile .career-today-return-banner')).toBeHidden();
    await captureS10Today(page, 'today-changes-1440');

    await page.getByRole('button', { name: 'Закрыть уведомление', exact: true }).click();
    await expect(page.locator('.career-today-changes')).toHaveCount(0);

    // Check responsive layout on 390
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.career-today-return-banner')).toBeVisible();
    await expect(page.locator('.career-today-changes')).toBeHidden();
    const narrowOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(narrowOverflow).toBeLessThanOrEqual(0);
    await captureS10Today(page, 'today-changes-390');
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
    await openApp(page);

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
