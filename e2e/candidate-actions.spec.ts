import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const APPLICATION = {
  id: 'action-app-1',
  candidateId: 'readability-candidate',
  clusterId: 'action-cluster-1',
  stage: 'saved',
  closedReason: null,
  archiveReason: null,
  archivePreviousStage: null,
  processProfile: 'standard',
  vacancy: {
    title: 'Инженер платформы',
    company: 'Пример компании',
    url: 'https://hh.ru/vacancy/123',
    source: 'hh',
  },
  notes: null,
  followUpDueAt: null,
  stageChangedAt: '2026-10-01T10:00:00.000Z',
  version: 1,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  followUp: null,
  whoseTurn: 'candidate',
  materials: { coverLetter: false, resume: false },
  nearestInterview: null,
};

const ACTION_USAGE = {
  usage: {
    localDate: '2026-10-01',
    hhAppliesCount: 0,
    linkedinEasyAppliesCount: 0,
    hhBoostsCount: 0,
    lastHhBoostAt: null,
  },
  timezone: 'Europe/Moscow',
  resetAt: '2026-10-01T21:00:00.000Z',
  killSwitchActive: false,
  limits: {
    maxHhAppliesPerDay: 15,
    maxLinkedinEasyAppliesPerDay: 10,
    maxHhBoostsPerDay: 3,
    minHhBoostIntervalMinutes: 240,
  },
};

async function mockCandidateActionApi(page: Page): Promise<() => unknown> {
  let submitted: unknown;
  let completedBatchId: string | null = null;
  let actionUsage = ACTION_USAGE;
  let actionApplications = [APPLICATION];
  await page.route('**/api/v1/candidate/applications*', (route) =>
    route.fulfill({ json: { data: actionApplications } }),
  );
  await page.route('**/api/v1/candidate/actions/usage*', (route) =>
    route.fulfill({ json: { data: actionUsage } }),
  );
  await page.route('**/api/v1/candidate/actions/receipts*', (route) => {
    const url = new URL(route.request().url());
    const batchId = url.searchParams.get('batchId');
    return route.fulfill({
      json: {
        data: {
          receipts:
            completedBatchId && (!batchId || batchId === completedBatchId)
              ? [
                  {
                    id: '00000000-0000-4000-8000-000000000002',
                    batchId,
                    candidateId: 'readability-candidate',
                    platform: 'hh',
                    actionKind: 'hh_apply',
                    status: 'delivered',
                    applicationId: 'action-app-1',
                    failureCode: null,
                    executedAt: '2026-10-01T12:00:00.000Z',
                    createdAt: '2026-10-01T12:00:00.000Z',
                  },
                ]
              : [],
        },
      },
    });
  });
  await page.route('**/api/v1/me/consents/actions_on_behalf', (route) =>
    route.fulfill({
      json: {
        data: {
          capability: 'actions_on_behalf',
          granted: true,
          consent: { versionId: 'actions_on_behalf-v1.0' },
        },
      },
    }),
  );
  await page.route('**/api/v1/candidate/actions/batch', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    submitted = route.request().postDataJSON();
    completedBatchId = (submitted as { batchId: string }).batchId;
    const actions = (
      submitted as {
        actions: Array<{ id: string; platform: string; actionKind: string; applicationId: string }>;
      }
    ).actions;
    const deliveredApplicationIds = new Set(
      actions
        .filter(
          (action) =>
            action.actionKind === 'hh_apply' || action.actionKind === 'linkedin_easy_apply',
        )
        .map((action) => action.applicationId),
    );
    actionApplications = actionApplications.map((application) =>
      deliveredApplicationIds.has(application.id)
        ? {
            ...application,
            stage: 'applied',
            version: application.version + 1,
            deliveryReceipt: { kind: 'auto_reply', value: 'hh.ru подтвердил отправку отклика' },
          }
        : application,
    );
    actionUsage = {
      ...actionUsage,
      usage: {
        ...actionUsage.usage,
        hhAppliesCount:
          actionUsage.usage.hhAppliesCount +
          actions.filter((action) => action.actionKind === 'hh_apply').length,
        linkedinEasyAppliesCount:
          actionUsage.usage.linkedinEasyAppliesCount +
          actions.filter((action) => action.actionKind === 'linkedin_easy_apply').length,
        hhBoostsCount:
          actionUsage.usage.hhBoostsCount +
          actions.filter((action) => action.actionKind === 'hh_resume_boost').length,
      },
    };
    return route.fulfill({
      json: {
        data: {
          batchId: completedBatchId,
          status: 'completed',
          receipts: actions.map((action) => ({
            id: action.id,
            batchId: completedBatchId,
            candidateId: 'readability-candidate',
            platform: action.platform,
            actionKind: action.actionKind,
            status: 'delivered',
            applicationId: action.applicationId,
            failureCode: null,
            executedAt: '2026-10-01T12:00:00.000Z',
            createdAt: '2026-10-01T12:00:00.000Z',
          })),
        },
      },
    });
  });
  await page.route('**/api/v1/candidate/actions/kill-switch', (route) =>
    route.fulfill({
      json: { data: { ok: true, active: true, scope: 'candidate:readability-candidate' } },
    }),
  );
  return () => submitted;
}

test('candidate reviews and submits a prepared action on desktop and mobile', async ({
  page,
}, testInfo) => {
  await page.clock.install({ time: new Date('2026-10-01T12:00:00.000Z') });
  const unmatched = await mockSignedInCabinet(page);
  const submitted = await mockCandidateActionApi(page);
  let platformCalls = 0;
  await page.route('https://hh.ru/**', (route) => {
    platformCalls += 1;
    return route.abort();
  });
  await page.route('https://**.linkedin.com/**', (route) => {
    platformCalls += 1;
    return route.abort();
  });

  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.locator('button[aria-label="Отклики"]:visible').first().click();
  const panel = page.getByRole('region', { name: 'Отправка откликов' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Инженер платформы')).toBeVisible();
  await panel.getByRole('checkbox', { name: /Инженер платформы/ }).check();
  await panel
    .getByLabel('Текст письма или заметки для площадки')
    .fill('Проверенное тестовое письмо.');
  await panel.getByRole('checkbox', { name: /Я проверил письма и ссылки/ }).check();
  const sendAction = panel.getByRole('button', { name: 'Отправить 1 действие' });
  await sendAction.click();

  await expect(panel).toContainText('Площадка подтвердила 1 действие');
  await expect(panel).toContainText('Доставлено');
  await expect(panel).toHaveAttribute('aria-busy', 'false');
  await expect(
    page
      .locator('.career-responses-column[aria-label="Хочу"] .career-responses-card')
      .filter({ hasText: 'Инженер платформы' }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('.career-responses-column[aria-label="Отправлено"] .career-responses-card')
      .filter({ hasText: 'Инженер платформы' }),
  ).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Отправить 0 действий' })).toBeDisabled();
  expect(submitted()).toMatchObject({
    confirmedByCandidate: true,
    actions: [
      {
        platform: 'hh',
        actionKind: 'hh_apply',
        applicationId: 'action-app-1',
        targetUrl: 'https://hh.ru/vacancy/123',
        letterText: 'Проверенное тестовое письмо.',
      },
    ],
  });
  expect(platformCalls).toBe(0);
  expect(unmatched).toEqual([]);
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: testInfo.outputPath(`candidate-actions-${testInfo.project.name}.png`),
    fullPage: true,
  });
  if (testInfo.project.name === 'desktop-1440') {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(panel.getByRole('heading', { name: 'Отправка откликов' })).toBeVisible();
    const desktopOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desktopOverflow).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: testInfo.outputPath('candidate-actions-1280.png'),
    });
  }
});
