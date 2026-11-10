import { expect, test, type Page, type Route } from '@playwright/test';
import { join } from 'node:path';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { todaySnapshot } from './fixtures/readabilityWorkspace';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';

/**
 * B632 (П2 из прохода новичка B630): через неделю кандидат находит отклик, где нужен его
 * ответ. Snowflake отправлен 01.10, сегодня 10.11 — дальше периода «30 дней». Он виден
 * в «Откликах» по умолчанию, а строка «Сегодня» открывает именно его, а не чужой отклик.
 */

const NOW = new Date('2026-11-10T09:00:00.000Z');
const EVIDENCE_DIR = e2eEvidenceDirectory('b632-open-responses-visible');

function application(id: string, company: string, overrides: Record<string, unknown>) {
  return {
    id,
    candidateId: 'candidate-fixture',
    clusterId: `cl-${id}`,
    stage: 'applied',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: {
      title: 'Director of Engineering',
      company,
      url: 'https://x.test',
      source: 'linkedin',
    },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-11-08T10:00:00.000Z',
    appliedAt: '2026-11-08T10:00:00.000Z',
    version: 1,
    createdAt: '2026-11-08T10:00:00.000Z',
    updatedAt: '2026-11-08T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    deliveryReceipt: null,
    labels: [],
    ...overrides,
  };
}

const APPLICATIONS = [
  application('app-firstrade', 'Firstrade', {}),
  application('app-snowflake', 'Snowflake', {
    createdAt: '2026-10-01T10:00:00.000Z',
    stageChangedAt: '2026-10-01T10:00:00.000Z',
    appliedAt: '2026-10-01T10:00:00.000Z',
    whoseTurn: 'candidate',
    followUp: {
      dueAt: '2026-10-08T00:00:00.000Z',
      urgency: 'overdue',
      source: 'standard_schedule',
      daysSinceContact: 40,
    },
  }),
  application('app-intouch', 'Intouch', {
    stage: 'interview',
    createdAt: '2026-09-25T10:00:00.000Z',
    stageChangedAt: '2026-10-20T10:00:00.000Z',
  }),
];

const TODAY = {
  ...todaySnapshot,
  queue: [
    {
      kind: 'follow_up',
      applicationId: 'app-snowflake',
      title: 'Director of Engineering',
      company: 'Snowflake',
      eyebrow: 'Follow-up · 40 дней без ответа',
      dueAt: '2026-10-08T00:00:00.000Z',
      fit: null,
    },
  ],
  followUps: [
    {
      applicationId: 'app-snowflake',
      company: 'Snowflake',
      title: 'Director of Engineering',
      status: 'overdue',
    },
  ],
};

function stageCounts(items: readonly { stage: string }[]) {
  const counts: Record<string, number> = {
    saved: 0,
    applied: 0,
    responded: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    archived: 0,
  };
  for (const item of items) counts[item.stage] = (counts[item.stage] ?? 0) + 1;
  return counts;
}

/** The server dates every stage, like the real list route does. */
async function fulfillApplications(route: Route, queries: string[]) {
  const url = new URL(route.request().url());
  queries.push(url.search);
  const stages = url.searchParams.getAll('stage').flatMap((value) => value.split(','));
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const items = APPLICATIONS.filter((item) => {
    const day = item.createdAt.slice(0, 10);
    if (stages.length && !stages.includes(item.stage)) return false;
    return (!from || day >= from) && (!to || day <= to);
  });
  await route.fulfill({
    json: {
      data: items,
      meta: { total: items.length, offset: 0, limit: 100, stageCounts: stageCounts(items) },
    },
  });
}

async function install(page: Page): Promise<string[]> {
  await mockSignedInCabinet(page);
  await page.clock.setFixedTime(NOW);
  const queries: string[] = [];
  await page.route(/\/api\/v1\/candidate\/today(\?.*)?$/u, (route) =>
    route.fulfill({ json: { data: TODAY } }),
  );
  await page.route('**/api/v1/candidate/applications?*', (route) =>
    route.request().method() === 'GET' ? fulfillApplications(route, queries) : route.fallback(),
  );
  return queries;
}

test.describe('B632 — открытые отклики видны всегда', () => {
  test('из «Сегодня» одним кликом на выделенный отклик старше 30 дней', async ({
    page,
  }, testInfo) => {
    const queries = await install(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });

    const row = page.getByRole('button', { name: /^Открыть: Snowflake/u }).first();
    await expect(row).toBeVisible();
    await row.click();

    const mobile = testInfo.project.name === 'mobile-390';
    const selected = mobile
      ? page.locator('.career-responses-mobile-push')
      : page.locator('.career-responses-selected');
    await expect(selected).toContainText('Snowflake');
    await expect(selected).not.toContainText('Firstrade');
    await expect(selected).toContainText('Напомнить компании про ответ');
    await page.screenshot({
      path: join(EVIDENCE_DIR, `${testInfo.project.name}-from-today.png`),
      fullPage: true,
    });

    // The pool is read whole: the period never reaches the server for open responses.
    expect(queries.some((query) => /[?&](from|to)=/u.test(query))).toBe(false);
  });

  test('по умолчанию в «Откликах» видны Snowflake и Intouch', async ({ page }, testInfo) => {
    await install(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await page.locator('button[aria-label="Отклики"]:visible').first().click();
    const list =
      testInfo.project.name === 'mobile-390'
        ? page.locator('.career-responses-mobile-feed')
        : page.locator('.career-responses-board-wrap');
    await expect(list).toContainText('Snowflake');
    await expect(list).toContainText('Intouch');
    await expect(list).toContainText('Firstrade');
    await page.screenshot({
      path: join(EVIDENCE_DIR, `${testInfo.project.name}-default.png`),
      fullPage: true,
    });
  });
});
