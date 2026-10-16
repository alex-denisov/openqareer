import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { captureCareerHarness } from './helpers/capture-career-harness';
import { waitForCareerShell } from './helpers/waitForCareerShell';

/**
 * B251 S3 — экран «Отклики» (канбан пайплайна из макета
 * docs/v1-release/tasks/work/B248/responses.html). Проверяет, что доска
 * подключена (а не редирект), колонки и счётчики совпадают с макетом и
 * экран не переполняет вьюпорт ни на 1440, ни на 390.
 */

const CANDIDATE = {
  username: 'responses.candidate',
  email: 'responses.candidate@example.com',
  displayName: 'Кандидат Откликов',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-b251',
};

const ACCOUNT = {
  username: CANDIDATE.username,
  email: CANDIDATE.email,
  displayName: CANDIDATE.displayName,
  profile: {
    headline: 'Enterprise Architect',
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

const WORKSPACE_INPUT = {
  resumeText: 'Enterprise Architect with 15+ years scaling platform and operations organisations.',
  resumeSource: 'text' as const,
  targetDirection: 'Enterprise Architect',
  regions: ['mena', 'eu'],
  currentSituation: 'Ищу роль Enterprise Architect.',
  constraints: 'Hybrid',
  urgency: 'active' as const,
};

const RECENT_APPLICATION_DATE = new Date().toISOString();

function application(overrides: Record<string, unknown>) {
  return {
    id: overrides.id,
    candidateId: CANDIDATE.candidateId,
    clusterId: overrides.clusterId ?? null,
    stage: 'applied',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: null,
    notes: null,
    followUpDueAt: null,
    stageChangedAt: RECENT_APPLICATION_DATE,
    version: 1,
    createdAt: RECENT_APPLICATION_DATE,
    updatedAt: RECENT_APPLICATION_DATE,
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    archiveStaleDays: 30,
    ...overrides,
  };
}

const APPLICATIONS = [
  application({
    id: 'a-1',
    stage: 'saved',
    vacancy: {
      title: 'Cloud & Infra Solution Architect',
      company: 'Sonsoft Inc',
      url: 'https://hh.ru/vacancy/1',
      source: 'hh',
    },
    whoseTurn: 'candidate',
    materials: { coverLetter: false, resume: false },
  }),
  application({
    id: 'a-2',
    stage: 'saved',
    vacancy: {
      title: 'Platform Architect',
      company: 'Nordwind',
      url: 'https://hh.ru/vacancy/2',
      source: 'hh',
    },
    whoseTurn: 'candidate',
    materials: { coverLetter: false, resume: false },
  }),
  application({
    id: 'a-3',
    stage: 'applied',
    vacancy: {
      title: 'Enterprise Architect, Senior Advisor',
      company: 'Peraton',
      url: 'https://hh.ru/vacancy/3',
      source: 'hh',
    },
    whoseTurn: 'candidate',
    followUp: {
      dueAt: '2026-09-24T00:00:00.000Z',
      urgency: 'due',
      source: 'auto',
      daysSinceContact: 6,
    },
  }),
  application({
    id: 'a-4',
    stage: 'applied',
    vacancy: {
      title: 'Business Information Architect',
      company: 'Genetec',
      url: 'https://hh.ru/vacancy/4',
      source: 'hh',
    },
    whoseTurn: 'company',
  }),
  application({
    id: 'a-5',
    stage: 'applied',
    vacancy: {
      title: 'VP Technology, executive search',
      company: '',
      companyHidden: true,
      url: 'https://hh.ru/vacancy/5',
      source: 'recruiter',
    },
    whoseTurn: 'company',
  }),
  application({
    id: 'a-6',
    stage: 'responded',
    vacancy: {
      title: 'Enterprise Architect Director',
      company: 'HRTx, Inc.',
      url: 'https://hh.ru/vacancy/6',
      source: 'hh',
    },
    whoseTurn: 'candidate',
  }),
  application({
    id: 'a-7',
    stage: 'interview',
    vacancy: {
      title: 'Enterprise Architect Director — раунд 2',
      company: 'HRTx, Inc.',
      url: 'https://hh.ru/vacancy/6',
      source: 'hh',
    },
    whoseTurn: 'candidate',
    nearestInterview: {
      id: 'iv-1',
      scheduledAt: '2026-09-26T14:00:00.000Z',
      prepStatus: 'not_started',
    },
  }),
  application({
    id: 'a-8',
    stage: 'rejected',
    closedReason: null,
    vacancy: {
      title: 'Consultant',
      company: 'Pyrovio',
      url: 'https://hh.ru/vacancy/8',
      source: 'hh',
    },
    whoseTurn: null,
  }),
  application({
    id: 'a-9',
    stage: 'archived',
    closedReason: null,
    vacancy: {
      title: 'Aotearoa Board Chair',
      company: 'Orange Sky Australia',
      url: 'https://hh.ru/vacancy/9',
      source: 'hh',
    },
    whoseTurn: null,
  }),
];

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

/** Diagnostics must be confirmed (B250) before the rail unlocks «Отклики». */
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
        ...WORKSPACE_INPUT,
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
      },
    },
  );
}

async function stubSession(
  page: Page,
  pendingApprovalCount: number | null = 0,
  applications: readonly unknown[] = APPLICATIONS,
): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
    if (pathname === '/api/v1/candidate/me') return route.fulfill({ json: { data: SNAPSHOT } });
    if (pathname === '/api/v1/account') return route.fulfill({ json: { data: ACCOUNT } });
    if (pathname === '/api/v1/candidate/connections') return route.fulfill({ json: { data: [] } });
    if (pathname === '/api/v1/candidate/me/messages')
      return route.fulfill({ json: { data: [], meta: { nextOffset: null } } });
    if (pathname === '/api/v1/candidate/workspace')
      return route.fulfill({ json: { data: WORKSPACE_INPUT } });
    if (pathname === '/api/v1/candidate/automation') {
      return route.fulfill({
        json: {
          data:
            pendingApprovalCount === null
              ? null
              : { queueCounts: { pending_approval: pendingApprovalCount } },
        },
      });
    }
    if (pathname === '/api/v1/candidate/applications') {
      return route.fulfill({ json: { data: applications } });
    }
    return route.fulfill({ json: { data: null } });
  });
}

async function openResponses(page: Page): Promise<void> {
  await waitForCareerShell(page);
  await page.locator('button[aria-label="Отклики"]:visible').first().click();
}

async function hideConsultantForEvidence(page: Page): Promise<void> {
  const closeButton = page.getByRole('button', {
    name: /^(Закрыть карьерного консультанта|Свернуть консультанта в полосу)$/u,
  });
  if (await closeButton.isVisible()) await closeButton.click();
}

test.describe('B251 responses screen', () => {
  // The fixtures are dated September 2026 and the board shows a 30-day window.
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-14T06:00:00.000Z'));
  });

  test('shows the four pipeline stages and keeps receipt status on sent cards', async ({
    page,
  }, testInfo) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openResponses(page);

    if (testInfo.project.name === 'mobile-390') {
      const rows = page.getByRole('listitem');
      await expect(rows.filter({ hasText: 'Enterprise Architect, Senior Advisor' })).toContainText(
        'Пробовали отправить',
      );
      await expect(
        rows.filter({ hasText: 'Enterprise Architect Director' }).filter({ hasText: 'Ответили' }),
      ).toContainText('Ответили');
      await expect(
        rows.filter({ hasText: 'Enterprise Architect Director — раунд 2' }),
      ).toContainText('Интервью');
      await expect(page.getByRole('button', { name: 'Архив · 1' })).toBeVisible();
      return;
    }

    const columns = page.locator('.career-responses-column');
    await expect(columns).toHaveCount(4);
    const columnCount = async (label: string) =>
      page
        .locator('.career-responses-column', {
          has: page.getByRole('heading', { name: label, exact: true }),
        })
        .locator('.career-responses-column-count')
        .innerText();
    await expect.poll(() => columnCount('Отправлено')).toBe('5');
    await page
      .locator('.career-responses-column[aria-label="Отправлено"]')
      .getByRole('button', { name: 'Показать ещё 20' })
      .click();
    const sentCards = page
      .locator('.career-responses-column')
      .filter({ has: page.getByRole('heading', { name: 'Отправлено', exact: true }) })
      .locator('.career-responses-card');
    await expect(sentCards).toHaveCount(5);
    await expect(
      sentCards.filter({ hasText: 'Enterprise Architect, Senior Advisor' }),
    ).toContainText('Пробовали отправить');
    await expect(sentCards.filter({ hasText: 'Cloud & Infra Solution Architect' })).toContainText(
      'Черновик, не отправлено',
    );
    await expect.poll(() => columnCount('Ответили')).toBe('1');
    await expect.poll(() => columnCount('Интервью')).toBe('1');
    await expect(
      page.locator('.career-responses-column[aria-label="Оффер"] .career-responses-column-count'),
    ).toHaveText('0');
    await expect(page.getByRole('button', { name: 'Архив · 1' })).toBeVisible();
  });

  test('shows three archive reasons and restores a card to its previous stage', async ({
    page,
  }, testInfo) => {
    const archivedApplications = [
      application({
        id: 'archive-candidate',
        clusterId: 'cluster-candidate',
        stage: 'archived',
        archiveReason: 'candidate',
        archivePreviousStage: 'applied',
        vacancy: { title: 'Role moved by candidate', company: 'Acme', url: '', source: 'test' },
      }),
      application({
        id: 'archive-closed',
        clusterId: 'cluster-closed',
        stage: 'archived',
        archiveReason: 'vacancy_closed',
        archivePreviousStage: 'responded',
        vacancy: { title: 'Role closed on source', company: 'Beta', url: '', source: 'test' },
      }),
      application({
        id: 'archive-stale',
        clusterId: 'cluster-stale',
        stage: 'archived',
        archiveReason: 'stale',
        archivePreviousStage: 'interview',
        archiveStaleDays: 30,
        vacancy: { title: 'Role without movement', company: 'Gamma', url: '', source: 'test' },
      }),
    ];

    await stubSession(page);
    await seedWorkspace(page);
    await page.route('**/api/v1/candidate/applications**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'GET' && pathname === '/api/v1/candidate/applications') {
        return route.fulfill({ json: { data: archivedApplications } });
      }
      if (request.method() === 'POST' && pathname.endsWith('/restore')) {
        const id = pathname.split('/').at(-2);
        const archived = archivedApplications.find((item) => item.id === id);
        if (!archived)
          return route.fulfill({ status: 404, json: { error: { message: 'not found' } } });
        return route.fulfill({
          json: {
            data: {
              ...archived,
              stage: archived.archivePreviousStage,
              archiveReason: null,
              archivePreviousStage: null,
              version: archived.version + 1,
            },
          },
        });
      }
      return route.fallback();
    });

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openResponses(page);

    const archiveToggle = page.getByRole('button', { name: 'Архив · 3' });
    await expect(archiveToggle).toHaveAttribute('aria-expanded', 'false');
    await archiveToggle.click();
    const archiveCards = page.locator('.career-responses-archive-card');
    await expect(archiveCards).toHaveCount(3);
    await expect(archiveCards.filter({ hasText: 'Role moved by candidate' })).toContainText(
      'Вы перенесли в архив',
    );
    await expect(archiveCards.filter({ hasText: 'Role closed on source' })).toContainText(
      'Вакансия закрыта',
    );
    await expect(archiveCards.filter({ hasText: 'Role without movement' })).toContainText(
      'Нет движения 30 дней',
    );

    if (testInfo.project.name === 'desktop-1440') {
      await mkdir('output/playwright/B363', { recursive: true });
      await page.setViewportSize({ width: 1176, height: 900 });
      await page.screenshot({ path: 'output/playwright/B363/responses-1176.png', fullPage: true });
      await captureCareerHarness(
        page,
        'output/playwright/B363/archive-harness.html',
        '.career-responses-archive',
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: 'output/playwright/B363/responses-390.png', fullPage: true });
      await archiveToggle.evaluate((toggle) =>
        toggle.scrollIntoView({ block: 'start', behavior: 'instant' }),
      );
      await page.screenshot({ path: 'output/playwright/B363/archive-390.png' });
      await page.setViewportSize({ width: 1176, height: 900 });
      await archiveToggle.evaluate((toggle) =>
        toggle.scrollIntoView({ block: 'start', behavior: 'instant' }),
      );
      await page.screenshot({ path: 'output/playwright/B363/archive-1176.png' });
    }

    await archiveCards
      .filter({ hasText: 'Role moved by candidate' })
      .getByRole('button', { name: 'Вернуть в работу' })
      .click();

    await expect(page.getByRole('button', { name: 'Архив · 2' })).toBeVisible();
    if (testInfo.project.name === 'mobile-390') {
      await expect(
        page.getByRole('listitem').filter({ hasText: 'Role moved by candidate' }),
      ).toBeVisible();
    } else {
      await expect(
        page.locator('.career-responses-column[aria-label="Отправлено"] .career-responses-card'),
      ).toContainText('Role moved by candidate');
    }
  });

  test('shows role, company and hidden-company copy on cards', async ({ page }, testInfo) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openResponses(page);

    if (testInfo.project.name === 'mobile-390') {
      const rows = page.getByRole('listitem');
      await expect(rows.filter({ hasText: 'Enterprise Architect, Senior Advisor' })).toContainText(
        'Peraton',
      );
      await expect(rows.filter({ hasText: 'VP Technology, executive search' })).toContainText(
        'Компания скрыта',
      );
      return;
    }

    const board = page.locator('.career-responses-board');
    await page
      .locator('.career-responses-column[aria-label="Отправлено"]')
      .getByRole('button', { name: 'Показать ещё 20' })
      .click();
    await expect(board).toContainText('Enterprise Architect, Senior Advisor');
    await expect(board).toContainText('Peraton');
    await expect(board).toContainText('компания скрыта');
  });

  test('refreshes a card after another window wins the version conflict', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile-390',
      'B486 exercises the mobile next-step panel; this test covers the desktop card menu',
    );
    await stubSession(page);
    await seedWorkspace(page);
    let changedElsewhere = false;
    const latestApplications = APPLICATIONS.map((item) =>
      item.id === 'a-1' ? application({ ...item, stage: 'responded', version: 2 }) : item,
    );
    await page.route('**/api/v1/candidate/applications**', async (route) => {
      const request = route.request();
      if (request.method() === 'PATCH') {
        changedElsewhere = true;
        await route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'application_version_conflict',
              message: 'Карточку изменили в другом окне. Обновите данные и повторите действие.',
              details: { currentVersion: 2 },
            },
          },
        });
        return;
      }
      if (request.method() === 'GET') {
        await route.fulfill({
          json: { data: changedElsewhere ? latestApplications : APPLICATIONS },
        });
        return;
      }
      await route.fallback();
    });

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openResponses(page);

    const card = page.getByRole('article').filter({ hasText: 'Cloud & Infra Solution Architect' });
    await card.getByRole('button', { name: 'Действия с карточкой' }).click();
    await card.getByRole('combobox', { name: 'Этап' }).selectOption('responded');
    await card.getByRole('button', { name: 'Сохранить этап' }).click();

    const conflict = card.getByRole('alert');
    await expect(conflict).toContainText('Карточку изменили в другом окне.');
    await expect(conflict).toContainText('Ваши изменения не сохранены.');
    await expect(conflict.getByRole('button', { name: 'Обновить карточку' })).toBeVisible();
    await mkdir('output/playwright/B251', { recursive: true });
    await page.screenshot({
      path: `output/playwright/B251/conflict-${testInfo.project.name}.png`,
      fullPage: true,
    });

    await conflict.getByRole('button', { name: 'Обновить карточку' }).click();
    const updatedCard = page
      .locator('.career-responses-column[aria-label="Ответили"] .career-responses-card')
      .filter({ hasText: 'Cloud & Infra Solution Architect' });
    await expect(updatedCard).toBeVisible();
    await expect(updatedCard.getByRole('alert')).toHaveCount(0);
  });

  test('marks a sent follow-up from the selected response panel and refreshes its deadline', async ({
    page,
  }, testInfo) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.route('**/api/v1/candidate/applications/a-3/events', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ kind: 'follow_up_sent' });
      await route.fulfill({
        json: {
          data: application({
            ...APPLICATIONS[2],
            followUp: {
              dueAt: '2026-10-02T00:00:00.000Z',
              urgency: 'upcoming',
              source: 'standard_schedule',
              daysSinceContact: 0,
            },
            whoseTurn: 'company',
          }),
        },
      });
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openResponses(page);

    if (testInfo.project.name === 'mobile-390') {
      const response = page
        .getByRole('list', { name: 'Нужно действие' })
        .getByRole('listitem')
        .filter({ hasText: 'Peraton' });
      await response.getByRole('button', { name: /Открыть следующий шаг/ }).click();
    } else {
      const card = page.locator('.career-responses-card').filter({ hasText: 'Peraton' });
      await card.locator('.career-responses-card-body').click();
    }
    const selectedPanel = page.locator('.career-responses-selected');
    await expect(selectedPanel).toBeVisible();
    await selectedPanel.getByRole('button', { name: 'Напоминание отправлено' }).click();
    await expect(selectedPanel.getByRole('button', { name: 'Напоминание отправлено' })).toHaveCount(
      0,
    );
    await expect(selectedPanel).toContainText('Отправлен · рано для напоминания компании');
  });

  test('the screen fits 1440 and 390 with no horizontal overflow', async ({ page }, testInfo) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });

    await page.setViewportSize({ width: 1440, height: 900 });
    await openResponses(page);
    await expect(page.locator('.career-responses-board-wrap')).toBeVisible();
    const overflow1440 = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow1440).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: process.env.SHOTS_DIR
        ? `${process.env.SHOTS_DIR}/responses-1440.png`
        : testInfo.outputPath('responses-1440.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow390 = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow390).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: process.env.SHOTS_DIR
        ? `${process.env.SHOTS_DIR}/responses-390.png`
        : testInfo.outputPath('responses-390.png'),
      fullPage: true,
    });
  });

  test('empty pipeline shows the mockup copy', async ({ page }) => {
    await seedWorkspace(page);
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
      if (pathname === '/api/v1/candidate/me') return route.fulfill({ json: { data: SNAPSHOT } });
      if (pathname === '/api/v1/account') return route.fulfill({ json: { data: ACCOUNT } });
      if (pathname === '/api/v1/candidate/connections')
        return route.fulfill({ json: { data: [] } });
      if (pathname === '/api/v1/candidate/workspace')
        return route.fulfill({ json: { data: null } });
      if (pathname === '/api/v1/candidate/applications')
        return route.fulfill({ json: { data: [] } });
      return route.fulfill({ json: { data: null } });
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openResponses(page);

    await expect(page.locator('.career-responses-empty')).toContainText('Откликов пока нет');
    await expect(page.locator('.career-responses-empty')).toContainText(
      'Здесь появится карточка каждого отклика',
    );
    await expect(page.locator('.career-responses-empty')).toContainText(
      'Откликнитесь на вакансию из подборки',
    );
    await expect(
      page.locator('.career-responses-empty').getByRole('button', { name: 'Перейти к вакансиям' }),
    ).toBeVisible();
  });

  test('a load error shows the offline message and a retry action', async ({ page }) => {
    await seedWorkspace(page);
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
      if (pathname === '/api/v1/candidate/me') return route.fulfill({ json: { data: SNAPSHOT } });
      if (pathname === '/api/v1/account') return route.fulfill({ json: { data: ACCOUNT } });
      if (pathname === '/api/v1/candidate/connections')
        return route.fulfill({ json: { data: [] } });
      if (pathname === '/api/v1/candidate/workspace')
        return route.fulfill({ json: { data: null } });
      if (pathname === '/api/v1/candidate/applications')
        return route.fulfill({ status: 500, json: { error: 'boom' } });
      return route.fulfill({ json: { data: null } });
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    await page.locator('button[aria-label="Отклики"]:visible').first().click();
    const responseError = page.locator('.career-main .career-expert-error');
    await expect(responseError).toBeVisible();
    await expect(responseError).toContainText('Сервис не завершил действие');
    await expect(responseError.getByRole('button', { name: 'Повторить' })).toBeVisible();
  });

  test('D15: the approved Today omits the campaign path on desktop and mobile', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });

    // The approved Today (1440 and 390) no longer includes the campaign stepper.
    await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('.career-path')).not.toBeVisible();
    await expect(page.locator('.career-responses-filter-notice')).toHaveCount(0);
  });

  test('B450: columns, table and channel performance use the same response cohort', async ({
    page,
  }, testInfo) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openResponses(page);

    const viewport = page.viewportSize();
    if (viewport?.width === 390) {
      await expect(page.getByRole('list', { name: 'Нужно действие' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Колонки', exact: true })).toBeHidden();
      await page.screenshot({ path: testInfo.outputPath('b450-home-390.png'), fullPage: true });
      return;
    }

    await expect(page.getByRole('button', { name: 'Колонки', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Таблица', exact: true }).click();
    await expect(page.locator('.career-responses-table')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('b450-table-1440.png'), fullPage: true });
    await page.getByRole('button', { name: 'Колонки', exact: true }).click();
    await expect(page.locator('.career-responses-board')).toBeVisible();
    const channelSection = page.locator('.career-responses-channel-performance');
    await expect(channelSection).toBeVisible();
    await expect(channelSection).toContainText('выборка 7');
    await expect(channelSection).toContainText('Меньше 20 откликов: узкие места не определены.');
    await expect(channelSection.locator('tbody tr')).toHaveCount(2);
    await expect(channelSection).toContainText('Ввод вручную');
    await page.screenshot({ path: testInfo.outputPath('b450-channels-1440.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await hideConsultantForEvidence(page);
    await channelSection.scrollIntoViewIfNeeded();
    await channelSection.screenshot({ path: testInfo.outputPath('b450-channels-390.png') });
    await captureCareerHarness(
      page,
      testInfo.outputPath('b450-channels-harness.html'),
      '.career-responses-channel-performance',
    );
  });

  test('B414: единое оформление select доказательства доставки и этапа', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile-390',
      'B486 verifies receipt-backed status in the compact mobile row',
    );
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openResponses(page);

    const peratonCard = page.locator('.career-responses-card').filter({ hasText: 'Peraton' });
    await expect(peratonCard).toBeVisible();
    const menuBtn = peratonCard.getByRole('button', { name: 'Действия с карточкой' });
    await menuBtn.click();

    const stageSelect = peratonCard.locator('select.career-responses-select').first();
    const deliveryLabel = peratonCard.locator('.career-responses-select-field').filter({
      hasText: 'Доказательство доставки',
    });
    const deliverySelect = deliveryLabel.locator('select.career-responses-select');
    await expect(stageSelect).toBeVisible();
    await expect(deliverySelect).toBeVisible();
    await expect(stageSelect).toHaveClass(/career-responses-select/);
    await expect(deliverySelect).toHaveClass(/career-responses-select/);
    const stageBox = await stageSelect.boundingBox();
    expect(stageBox).not.toBeNull();
    expect(stageBox!.height).toBeGreaterThanOrEqual(44);
    const deliveryBox = await deliverySelect.boundingBox();
    expect(deliveryBox).not.toBeNull();
    expect(deliveryBox!.height).toBeGreaterThanOrEqual(44);

    await mkdir('output/playwright/B414', { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({
      path: 'output/playwright/B414/responses-card-1440.png',
      fullPage: true,
    });
  });
});
