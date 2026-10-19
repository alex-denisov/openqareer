import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { captureCareerHarness } from './helpers/capture-career-harness';
import { waitForCareerShell } from './helpers/waitForCareerShell';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { openAutomationMobile } from './helpers/open-automation-mobile';

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
const ACC_A1_EVIDENCE_DIR = e2eEvidenceDirectory('ACC-A-1');

test.beforeAll(() => {
  mkdirSync(S10_EVIDENCE_DIR, { recursive: true });
  mkdirSync(ACC_A1_EVIDENCE_DIR, { recursive: true });
});

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

async function captureAccA1Today(page: Page, name: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const scrollHeight = await page.evaluate(() => {
    const scrollables = [...document.querySelectorAll<HTMLElement>('*')].filter((element) => {
      const style = getComputedStyle(element);
      return /(auto|scroll)/u.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    });
    return Math.max(
      document.documentElement.scrollHeight,
      ...scrollables.map((element) => element.getBoundingClientRect().top + element.scrollHeight),
    );
  });
  await page.setViewportSize({
    width: viewport.width,
    height: Math.max(viewport.height, scrollHeight),
  });
  const profileRow = page.locator(
    '.career-today-mobile .pm-group[aria-label="Дополнить профиль"] .pm-row',
  );
  if (await profileRow.count()) await profileRow.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(ACC_A1_EVIDENCE_DIR, `${name}.png`), fullPage: true });
  await captureCareerHarness(page, join(ACC_A1_EVIDENCE_DIR, `${name}.html`));
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
    {
      applicationId: 'app-1',
      company: 'Peraton',
      title: 'Enterprise Architect',
      status: 'overdue',
    },
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
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    followUp:
      stage === 'applied'
        ? {
            dueAt: '2026-09-23T00:00:00.000Z',
            urgency: 'overdue',
            source: 'standard_schedule',
            daysSinceContact: 6,
          }
        : null,
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
  // The server keeps «Отложить до завтра»; the mock does the same so a remount reads it back.
  let actionDeferral: { actionId: string; deferredThroughDate: string } | undefined;
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
    if (request.method() === 'POST' && pathname === '/api/v1/candidate/today/action-defer') {
      const { actionId } = request.postDataJSON() as { actionId: string };
      const today = new Date().toISOString().slice(0, 10);
      actionDeferral = { actionId, deferredThroughDate: today };
      return route.fulfill({ json: { data: actionDeferral } });
    }
    if (pathname === '/api/v1/candidate/today') {
      const base = followUpSent
        ? {
            ...todaySnapshot,
            digest: { ...todaySnapshot.digest, followUpsDueToday: 0, followUpCaptions: [] },
            queue: todaySnapshot.queue.filter(
              (item: { kind: string }) => item.kind !== 'follow_up',
            ),
            followUps: [],
          }
        : todaySnapshot;
      const data = actionDeferral ? { ...base, todayActionDeferral: actionDeferral } : base;
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
  test('shows the approved mobile Today screen and saves full-height evidence', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Today 390 acceptance.');
    await stubSession(page, PENDING_TODAY_SNAPSHOT);
    await seedWorkspace(page);
    await openApp(page);

    const mobile = page.locator('.career-today-mobile');
    const decision = page.getByRole('region', { name: 'Следующее решение' });
    const queue = page.getByRole('region', { name: 'Очередь дня' });
    const funnel = page.getByRole('region', { name: 'Воронка за 30 дней' });
    await expect(mobile).toBeVisible();
    await expect(page.locator('.career-page-header')).toBeHidden();
    await expect(page.locator('.career-path')).toBeHidden();
    await expect(page.getByText('ЛИЧНЫЙ КАБИНЕТ', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Спросить консультанта' })).toHaveCount(0);
    await expect(decision).toContainText('Добавим полный источник');
    await expect(decision.locator('.tm-main')).toBeEnabled();
    await expect(decision.getByRole('button', { name: 'Почему это решение' })).toBeEnabled();
    await expect(queue.getByTestId('today-mobile-queue-row')).toHaveCount(4);
    await expect(queue.locator('.pm-row.is-warn')).toHaveCount(1);
    await expect(funnel.getByRole('listitem')).toHaveCount(4);
    await expect(funnel).toContainText('Нет проверенных данных');
    await expect(mobile.getByRole('button', { name: /Перейти в профиль/u })).toBeEnabled();
    await expect(
      mobile.locator(
        '.career-today-return-banner, .career-today-digest, .career-momentum-widget, .career-drafts, .career-onboarding',
      ),
    ).toHaveCount(0);
    const boxes = await mobile.evaluate((root) => {
      const rect = (selector: string) => {
        const box = root.querySelector(selector)?.getBoundingClientRect();
        return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
      };
      const hero = root.querySelector<HTMLElement>('.tm-hero');
      const heroStyles = hero ? getComputedStyle(hero) : null;
      const heroChildren = hero
        ? [...hero.children].map((child) => {
            const box = child.getBoundingClientRect();
            const style = getComputedStyle(child);
            return {
              tag: child.tagName,
              className: child.getAttribute('class'),
              text: child.textContent?.trim(),
              height: box.height,
              fontSize: style.fontSize,
              lineHeight: style.lineHeight,
              minBlockSize: style.minBlockSize,
            };
          })
        : [];
      const queueRowHeights = [
        ...root.querySelectorAll<HTMLElement>('.pm-group[aria-label="Очередь дня"] .pm-row'),
      ].map((row) => row.getBoundingClientRect().height);
      return {
        root: rect('.career-today-mobile'),
        hero: rect('.tm-hero'),
        heroGridRows: heroStyles?.gridTemplateRows,
        heroGap: heroStyles?.rowGap,
        heroPaddingBlock: heroStyles
          ? [heroStyles.paddingBlockStart, heroStyles.paddingBlockEnd]
          : null,
        heroChildren,
        main: rect('.tm-main'),
        later: rect('.tm-later'),
        why: rect('.tm-why'),
        queue: rect('.pm-group[aria-label="Очередь дня"]'),
        list: rect('.pm-group[aria-label="Очередь дня"] .pm-list'),
        queueRowHeights,
        funnel: rect('.tm-funnel'),
        profile: rect('.pm-group[aria-label="Дополнить профиль"] .pm-row'),
      };
    });
    const expectSize = (
      box: { width: number; height: number } | null,
      width: number,
      height: number,
      label: string,
    ) => {
      expect(box, label).not.toBeNull();
      if (!box) return;
      expect(Math.abs(box.width - width), label).toBeLessThanOrEqual(1);
      expect(
        Math.abs(box.height - height),
        `${label}; hero details: ${JSON.stringify({ children: boxes.heroChildren, rows: boxes.heroGridRows, gap: boxes.heroGap, padding: boxes.heroPaddingBlock })}`,
      ).toBeLessThanOrEqual(1);
    };
    expectSize(boxes.hero, 358, 328, 'hero 358x328');
    expectSize(boxes.main, 326, 48, 'primary action 326x48');
    expectSize(boxes.later, 184, 44, 'defer action 184x44');
    expectSize(boxes.why, 326, 48, 'consultant action 326x48');
    expect(Math.abs((boxes.list?.width ?? 0) - 358)).toBeLessThanOrEqual(1);
    expect(boxes.queueRowHeights).toHaveLength(4);
    expect(
      boxes.queueRowHeights.every(
        (height) => Math.abs(height - 60) <= 1 || Math.abs(height - 79) <= 1,
      ),
    ).toBe(true);
    expectSize(boxes.funnel, 358, 84, 'funnel 358x84');
    expect(Math.abs((boxes.profile?.width ?? 0) - 358)).toBeLessThanOrEqual(1);
    const profileHeight = boxes.profile?.height ?? 0;
    expect(
      Math.abs(profileHeight - 60) <= 1 || Math.abs(profileHeight - 79) <= 1,
      `profile row height ${profileHeight}`,
    ).toBe(true);
    expect(boxes.queue?.x).toBe(boxes.hero?.x);
    expect(boxes.funnel?.x).toBe(boxes.hero?.x);
    expect(boxes.profile?.x).toBe(boxes.hero?.x);
    await captureAccA1Today(page, '390-default');
    await captureCareerHarness(page, testInfo.outputPath('today-screen-mobile.html'));
  });

  test('accepting the next decision completes the profile navigation', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Decision acceptance at 390.');
    await stubSession(page);
    await seedWorkspace(page);
    await openApp(page);

    const accept = page.locator('.career-today-mobile .tm-main');
    await expect(accept).toBeEnabled();
    await accept.click();
    await expect(page.locator('.career-page-header h1')).toHaveText('Профиль');
  });

  test('deferring the next decision hides it until the next day', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Decision deferral at 390.');
    await stubSession(page);
    await seedWorkspace(page);
    await openApp(page);

    const decision = page.getByRole('region', { name: 'Следующее решение' });
    await decision.getByRole('button', { name: 'Отложить до завтра' }).click();
    await expect(decision).toContainText('Нет проверенного следующего шага');
    await expect(decision.locator('.tm-main')).toHaveCount(0);
    await expect(decision.getByRole('button', { name: 'Отложить до завтра' })).toHaveCount(0);
    await captureAccA1Today(page, '390-deferred');

    await page.locator('.career-mobile-nav').getByRole('button', { name: 'Профиль' }).click();
    await expect(page.locator('.career-page-header h1')).toHaveText('Профиль');
    await page.locator('.career-mobile-nav').getByRole('button', { name: 'Сегодня' }).click();
    await expect(
      page.getByRole('region', { name: 'Следующее решение' }).locator('.tm-main'),
    ).toHaveCount(0);
  });

  test('queue rows and profile shortcut navigate to their real destinations on mobile', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Today navigation at 390.');
    await stubSession(page);
    await seedWorkspace(page);
    await openApp(page);
    await captureAccA1Today(page, '390-navigation');

    await page.getByRole('button', { name: /Открыть: Peraton/u }).click();
    await expect(page.locator('.career-page-header h1')).toHaveText('Отклики');
    await page.locator('.career-mobile-nav').getByRole('button', { name: 'Сегодня' }).click();
    await page.getByRole('button', { name: /Открыть: Genetec/u }).click();
    await expect(page.locator('.career-page-header h1')).toHaveText('Вакансии');
    await page.locator('.career-mobile-nav').getByRole('button', { name: 'Сегодня' }).click();

    const profileShortcut = page.getByRole('button', { name: /Перейти в профиль/u });
    await profileShortcut.click();
    await expect(page.locator('.career-page-header h1')).toHaveText('Профиль');
  });

  test('keeps the follow-up action available after a Today row opens Responses', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Follow-up transfer on mobile.');
    await stubSession(page);
    // Фикстуры датированы сентябрём–октябрём 2026: окно «30 дней» считается от этой даты, а не от часов машины.
    await page.clock.setFixedTime(new Date('2026-10-15T09:00:00.000Z'));
    await seedWorkspace(page);
    await page.route('**/api/v1/candidate/applications/app-1/events', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ kind: 'follow_up_sent' });
      await route.fulfill({
        json: {
          data: {
            ...TODAY_TRACKER_APPLICATIONS[0],
            followUp: {
              dueAt: '2026-10-20T00:00:00.000Z',
              urgency: 'upcoming',
              source: 'standard_schedule',
              daysSinceContact: 0,
            },
          },
        },
      });
    });
    await openApp(page);

    await page.getByRole('button', { name: /Открыть: Peraton/u }).click();
    await expect(page.locator('.career-page-header h1')).toHaveText('Отклики');
    const response = page
      .getByRole('list', { name: 'По сроку шага' })
      .getByRole('listitem')
      .filter({ hasText: 'Peraton' });
    await response.getByRole('button', { name: /Открыть следующий шаг/u }).click();

    const selectedPanel = page.locator('.career-responses-selected');
    const markSent = selectedPanel.getByRole('button', { name: 'Напоминание отправлено' });
    await expect(markSent).toBeVisible();
    const sentRequest = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        request.url().includes('/candidate/applications/app-1/events'),
    );
    await markSent.click();
    await sentRequest;
    await expect(markSent).toHaveCount(0);
    await expect(selectedPanel).toContainText('Отправлен');
  });

  test('B395: LinkedIn drafts stay reachable in Automation, outside mobile Today', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'mobile-390',
      'Checks the mobile Automation entry from the More menu.',
    );
    await mockSignedInCabinet(page, { candidateId: CANDIDATE.candidateId });
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    await page.locator('.career-mobile-nav').getByRole('button', { name: 'Сегодня' }).click();

    await expect(page.locator('.career-drafts')).toHaveCount(0);
    await expect(page.locator('.career-today-mobile')).toBeVisible();
    await captureAccA1Today(page, '390-linkedin-not-on-today');
    await openAutomationMobile(page);
    await page.getByRole('tab', { name: 'Посты LinkedIn', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Черновики для LinkedIn' })).toBeVisible();
  });

  test('keeps desktop Today unchanged and fits the approved mobile screen at 390', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Captures desktop and mobile once.');
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
    await expect(page.locator('.career-today-queue-desktop')).toBeVisible();
    await captureS10Today(page, 'today-1440');

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = page.locator('.career-today-mobile');
    await expect(mobile).toBeVisible();
    await expect(page.locator('.career-today-desktop')).toBeHidden();
    await expect(mobile.locator('.tm-hero')).toBeVisible();
    await expect(mobile.locator('.career-today-digest, .career-momentum-widget')).toHaveCount(0);
    await expect(mobile.getByTestId('today-mobile-queue-row')).toHaveCount(4);
    await expect(mobile.locator('.tm-funnel [role="listitem"]')).toHaveCount(4);
    const narrowOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(narrowOverflow).toBeLessThanOrEqual(0);
    await captureS10Today(page, 'today-390');
    await captureAccA1Today(page, '390-desktop-switch');
    await captureCareerHarness(page, testInfo.outputPath('today-screen-mobile.html'));
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

    const decision = page.getByRole('region', { name: 'Следующее решение' });
    const queue = page.getByRole('region', { name: 'Очередь дня' });
    await expect(decision).toContainText('Сейчас нечего решать. Очередь пуста.');
    await expect(decision.getByRole('button', { name: 'Открыть вакансии' })).toBeEnabled();
    await expect(decision.getByRole('button', { name: 'Обсудить цель' })).toBeEnabled();
    await expect(queue.locator('.pm-empty')).toHaveText(
      'Очередь дня пуста. Новые задачи появятся здесь.',
    );
    await expect(queue.getByTestId('today-mobile-queue-row')).toHaveCount(0);
    await captureAccA1Today(page, '390-empty-queue-no-decision');
  });

  test('shows a single mobile queue row without adding a show-more control', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Single queue row at 390.');
    await stubSession(page, { ...TODAY_SNAPSHOT, queue: [TODAY_SNAPSHOT.queue[0]] });
    await seedWorkspace(page);
    await openApp(page);

    const queue = page.getByRole('region', { name: 'Очередь дня' });
    await expect(queue.getByTestId('today-mobile-queue-row')).toHaveCount(1);
    await expect(queue).not.toContainText('Показать ещё');
    await captureAccA1Today(page, '390-queue-1');
  });

  test('keeps long mobile queue titles inside the row and viewport', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Long queue title at 390.');
    const longItem = {
      ...TODAY_SNAPSHOT.queue[1],
      company: 'Компания с очень длинным официальным названием',
      title: 'Head of Engineering and Infrastructure for a Global Platform',
      eyebrow: 'Новая вакансия · проверено сегодня',
    };
    await stubSession(page, { ...TODAY_SNAPSHOT, queue: [longItem] });
    await seedWorkspace(page);
    await openApp(page);

    const row = page.getByTestId('today-mobile-queue-row');
    await expect(row).toBeVisible();
    const title = row.locator('.pm-main b');
    await expect(title).toHaveCSS('text-overflow', 'ellipsis');
    const subtitleOverflow = await row
      .locator('.pm-main small')
      .evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(subtitleOverflow).toBe(false);
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow).toBeLessThanOrEqual(0);
    await captureAccA1Today(page, '390-long-queue-name');
  });

  test('caps a twenty item mobile queue at the four approved rows', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Today queue cap at 390.');
    const queue = Array.from({ length: 20 }, (_, index) => ({
      ...TODAY_SNAPSHOT.queue[0],
      kind: 'new_vacancy' as const,
      applicationId: 'long-queue-' + index,
      title: 'Enterprise Architect ' + index,
    }));
    await stubSession(page, { ...TODAY_SNAPSHOT, queue });
    await seedWorkspace(page);
    await openApp(page);

    const rows = page
      .getByRole('region', { name: 'Очередь дня' })
      .getByTestId('today-mobile-queue-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.last()).toContainText('Enterprise Architect 3');
    await captureAccA1Today(page, '390-queue-20');
  });

  test('shows the mobile loading skeleton while the Today request is pending', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Today loading state at 390.');
    await stubSession(page);
    let releaseToday: (() => void) | undefined;
    let requestStarted = false;
    const pending = new Promise<void>((resolve) => {
      releaseToday = resolve;
    });
    await page.route('**/api/v1/candidate/today*', async (route) => {
      requestStarted = true;
      await pending;
      await route.fulfill({ json: { data: TODAY_SNAPSHOT } });
    });
    await seedWorkspace(page);
    await openApp(page);

    await expect(page.locator('.today-loading-mobile')).toBeVisible();
    await expect.poll(() => requestStarted).toBe(true);
    await captureAccA1Today(page, '390-loading');
    releaseToday?.();
    await expect(page.locator('.career-today-mobile')).toBeVisible();
  });

  test('shows an error, then retries the Today request successfully', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Today retry state at 390.');
    await stubSession(page);
    let attempts = 0;
    await page.route('**/api/v1/candidate/today*', async (route) => {
      attempts += 1;
      if (attempts === 1) return route.abort();
      return route.fulfill({ json: { data: TODAY_SNAPSHOT } });
    });
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    await expect(page.getByRole('alert')).toContainText(
      'Не удалось собрать очередь: сервер не ответил.',
    );
    await captureAccA1Today(page, '390-error');
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.locator('.career-today-mobile')).toBeVisible();
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
    const why = page.getByRole('button', { name: 'Почему это решение' });
    await expect(why).toHaveAttribute('aria-expanded', 'false');
    await why.click();
    await expect(why).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.tm-reasons')).toBeVisible();
    await page.getByRole('button', { name: 'Консультант: открыть' }).click();
    await expect(page.getByRole('dialog', { name: /Консультант/u })).toBeVisible();
    await expect(page.getByLabel('Сообщение карьерному консультанту')).toBeVisible();
    if ((page.viewportSize()?.width ?? 1440) <= 760) {
      await expect(panel).toHaveAttribute('data-mobile-expanded', 'true');
    }
  });

  test('B255: returning changes stay on desktop and the old mobile banner stays absent', async ({
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
    await expect(page.locator('.career-today-mobile .career-today-return-banner')).toHaveCount(0);
    await captureS10Today(page, 'today-changes-1440');

    await page.getByRole('button', { name: 'Скрыть уведомление', exact: true }).click();
    await expect(page.locator('.career-today-changes')).toHaveCount(0);

    // Check responsive layout on 390
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.career-today-return-banner')).toHaveCount(0);
    await expect(page.locator('.career-today-changes')).toBeHidden();
    const narrowOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(narrowOverflow).toBeLessThanOrEqual(0);
    await captureS10Today(page, 'today-changes-390');
  });

  test('B344 D10: queue rows never use recruiter names as company names', async ({ page }) => {
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

    const desktopRow = page.getByRole('button', {
      name: 'Открыть: Компания не указана — Head of Engineering',
    });
    await expect(desktopRow.locator('.career-today-queue-desktop-copy strong')).toHaveText(
      'Новая вакансия: Head of Engineering',
    );
    await expect(desktopRow.locator('.career-today-queue-desktop-copy small')).toContainText(
      'Компания не указана',
    );
    await expect(desktopRow).not.toContainText('Глушкова');
    await page.screenshot({ path: 'output/playwright/B344/d10-today-queue-1176.png' });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileRow = page.getByRole('button', {
      name: 'Открыть: Компания не указана — Head of Engineering',
    });
    await expect(mobileRow.locator('.pm-main b')).toHaveText('Новая вакансия: Head of Engineering');
    await expect(mobileRow.locator('.pm-main small')).toContainText('Компания не указана');
    await expect(mobileRow).not.toContainText('Глушкова');
    await page.screenshot({ path: 'output/playwright/B344/d10-today-queue-390.png' });
  });
});
