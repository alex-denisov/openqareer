import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const EVIDENCE = e2eEvidenceDirectory('B473');
const GATE_HTML = join(process.cwd(), 'test-results', 'evidence', 'B473-dom');
const DIST_ASSETS = join(process.cwd(), 'dist', 'assets');

interface NotificationFixture {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly createdAt: string;
  readAt: string | null;
  readonly action: { readonly label: string; readonly href: string };
}

interface NotificationMockOptions {
  readonly items?: NotificationFixture[];
  readonly empty?: boolean;
  readonly pageSize?: number;
  readonly failGetAt?: number;
  readonly delayGetAt?: number;
  readonly failNextPageOnce?: boolean;
  readonly applicationHandler?: (route: Route, path: string) => Promise<boolean>;
}

function sampleNotifications(): NotificationFixture[] {
  return [
    notification(
      'notice-1',
      'email_approval',
      'Письмо ждёт одобрения',
      notificationTimestamp(0, 9),
      null,
      'Открыть письмо',
      '/app?view=profile',
    ),
    notification(
      'notice-2',
      'post_approval',
      'Пост ждёт одобрения',
      notificationTimestamp(0, 8),
      null,
      'Открыть пост',
      '/app?view=profile',
    ),
    notification(
      'notice-3',
      'interview_reminder',
      'Скоро интервью',
      notificationTimestamp(1, 12),
      null,
      'Напомнить за день',
      '/app?view=responses',
    ),
    notification(
      'notice-4',
      'employer_reply',
      'Есть ответ работодателя',
      notificationTimestamp(2, 12),
      '2026-10-10T12:00:00.000Z',
      'Напомнить рекрутеру',
      '/app?view=responses',
    ),
  ];
}

function notificationTimestamp(daysAgo: number, hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function notification(
  id: string,
  kind: string,
  title: string,
  createdAt: string,
  readAt: string | null,
  label: string,
  href: string,
): NotificationFixture {
  return { id, kind, title, createdAt, readAt, action: { label, href } };
}

const INTERVIEW_NOTICE = notification(
  'notice-interview',
  'interview_reminder',
  'Скоро интервью',
  notificationTimestamp(0, 9),
  null,
  'Напомнить за день',
  '/app?view=responses&notificationSource=interview-1',
);

const INTERVIEW_APPLICATION = {
  id: 'application-1',
  candidateId: 'candidate-1',
  clusterId: null,
  stage: 'applied',
  closedReason: null,
  archiveReason: null,
  archivePreviousStage: null,
  processProfile: 'standard',
  vacancy: null,
  notes: null,
  followUpDueAt: null,
  stageChangedAt: '2026-10-10T10:00:00.000Z',
  version: 2,
  createdAt: '2026-10-09T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
  followUp: null,
  whoseTurn: 'company',
  materials: { coverLetter: false, resume: false },
  nearestInterview: {
    id: 'interview-1',
    scheduledAt: '2026-10-15T12:00:00.000Z',
    prepStatus: 'none',
    round: 1,
  },
};

function createReminderApi() {
  let patchedReminder: Record<string, unknown> | null = null;
  const handler = async (route: Route, path: string): Promise<boolean> => {
    if (route.request().method() === 'GET' && path === '/api/v1/candidate/applications') {
      await route.fulfill({ json: { data: [INTERVIEW_APPLICATION] } });
      return true;
    }
    if (route.request().method() === 'PATCH' && path.endsWith('/interviews/interview-1')) {
      return fulfillInterviewReminder(route, (value) => {
        patchedReminder = value;
      });
    }
    return false;
  };
  return { handler, reminder: () => patchedReminder };
}

async function fulfillInterviewReminder(
  route: Route,
  save: (value: Record<string, unknown>) => void,
): Promise<boolean> {
  const payload = route.request().postDataJSON() as Record<string, unknown>;
  save(payload);
  await route.fulfill({
    json: {
      data: {
        id: 'interview-1',
        applicationId: 'application-1',
        round: 1,
        scheduledAt: '2026-10-15T12:00:00.000Z',
        prepStatus: 'none',
        ...payload,
      },
    },
  });
  return true;
}

interface NotificationRouteState {
  getCount: number;
  failedNextPage: boolean;
}

function createNotificationHandler(
  items: NotificationFixture[],
  options: NotificationMockOptions = {},
  state: NotificationRouteState,
) {
  return async (route: Route, path: string): Promise<boolean> => {
    if (path.endsWith('/preferences')) return fulfillEmptyPreferences(route);
    if (route.request().method() === 'GET')
      return serveNotificationPage(route, path, items, options, state);
    return mutateNotification(route, path, items);
  };
}

async function fulfillEmptyPreferences(route: Route): Promise<boolean> {
  await route.fulfill({ json: { data: { events: [] } } });
  return true;
}

async function serveNotificationPage(
  route: Route,
  path: string,
  items: NotificationFixture[],
  options: NotificationMockOptions,
  state: NotificationRouteState,
): Promise<boolean> {
  if (path !== '/api/v1/candidate/notifications') return false;
  state.getCount += 1;
  if (options.delayGetAt === state.getCount)
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  if (options.failGetAt === state.getCount) return fulfillUnavailable(route);
  return fulfillNotificationPage(route, items, options, state);
}

async function fulfillUnavailable(route: Route): Promise<boolean> {
  await route.fulfill({
    status: 503,
    json: { error: { code: 'notification_storage_unavailable' } },
  });
  return true;
}

async function fulfillNotificationPage(
  route: Route,
  items: NotificationFixture[],
  options: NotificationMockOptions,
  state: NotificationRouteState,
): Promise<boolean> {
  const url = new URL(route.request().url());
  const cursor = url.searchParams.get('cursor');
  if (cursor && options.failNextPageOnce && !state.failedNextPage) {
    state.failedNextPage = true;
    return fulfillUnavailable(route);
  }
  const offset = cursor ? Number(cursor.replace('cursor-', '')) : 0;
  const pageSize = options.pageSize ?? Math.min(20, items.length || 20);
  const nextOffset = offset + pageSize < items.length ? offset + pageSize : null;
  await route.fulfill({
    json: {
      data: {
        items: items.slice(offset, offset + pageSize),
        unreadCount: items.filter((item) => item.readAt === null).length,
        nextCursor: nextOffset === null ? null : `cursor-${nextOffset}`,
      },
    },
  });
  return true;
}

async function mutateNotification(
  route: Route,
  path: string,
  items: NotificationFixture[],
): Promise<boolean> {
  if (path.endsWith('/read-all')) {
    const updated = items.filter((item) => item.readAt === null).length;
    items.forEach((item) => {
      item.readAt ??= new Date().toISOString();
    });
    await route.fulfill({ json: { data: { updated } } });
    return true;
  }
  const id = path.split('/').at(-2);
  const selected = items.find((item) => item.id === id);
  if (!selected) return false;
  selected.readAt ??= new Date().toISOString();
  await route.fulfill({ json: { data: { id, readAt: selected.readAt } } });
  return true;
}

async function mockNotificationApi(
  page: Page,
  options: NotificationMockOptions = {},
): Promise<NotificationFixture[]> {
  const items = options.empty ? [] : (options.items ?? sampleNotifications());
  const state = { getCount: 0, failedNextPage: false };
  await mockSignedInCabinet(page, {
    notificationHandler: createNotificationHandler(items, options, state),
    applicationHandler: options.applicationHandler,
  });
  return items;
}

async function openToday(page: Page, options?: NotificationMockOptions): Promise<void> {
  await mockNotificationApi(page, options);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible();
}

async function capture(page: Page, testInfo: TestInfo, state: string): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true });
  mkdirSync(GATE_HTML, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: join(EVIDENCE, `${state}-${testInfo.project.name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
  await saveGateHtml(page, testInfo, state);
}

async function saveGateHtml(page: Page, testInfo: TestInfo, state: string): Promise<void> {
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll((links) =>
    links.map((link) => ({
      href: link.getAttribute('href'),
      absolute: (link as HTMLLinkElement).href,
    })),
  );
  let html = (await page.content())
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '')
    .replaceAll(' crossorigin=""', '');
  for (const style of styles) {
    if (!style.href || !style.absolute) continue;
    const local = pathToFileURL(join(DIST_ASSETS, basename(new URL(style.absolute).pathname))).href;
    html = html.replaceAll(style.href, local).replaceAll(style.absolute, local);
  }
  writeFileSync(join(GATE_HTML, `${state}-${testInfo.project.name}.html`), html);
}

test('desktop bell opens the notification center and actions update unread state', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'desktop flow only');
  await openToday(page);

  const bell = page.getByRole('button', { name: 'Центр уведомлений, 3 непрочитанных' });
  await expect(bell).toBeVisible();
  await capture(page, testInfo, 'bell-unread');
  await bell.click();
  const popover = page.getByRole('dialog', { name: 'Уведомления' });
  await expect(popover).toBeVisible();
  await expect(popover.getByText('Письмо ждёт одобрения')).toBeVisible();
  await capture(page, testInfo, 'bell-popover');
  await popover.getByRole('link', { name: 'Все уведомления' }).click();

  await expect(
    page.getByRole('region', { name: 'Центр уведомлений' }).getByRole('heading', {
      level: 1,
      name: 'Уведомления',
    }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Сегодня', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Раньше', level: 2 })).toBeVisible();
  await capture(page, testInfo, 'notification-list');
  await page.getByRole('button', { name: /Пост ждёт одобрения/u }).click();
  await expect(page.getByRole('heading', { name: 'Пост ждёт одобрения' })).toBeVisible();
  await expect(page.getByText('Не прочитано')).toHaveCount(0);
  await capture(page, testInfo, 'notification-detail');
  await page.getByRole('button', { name: 'Прочитать все' }).click();
  await expect(page.getByText('Непрочитанные 0')).toBeVisible();
});

test('mobile bell opens a list, then a detail screen with a working back action', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'mobile flow only');
  await openToday(page);

  const bell = page.getByRole('button', { name: 'Центр уведомлений, 3 непрочитанных' });
  await expect(bell).toBeVisible();
  await capture(page, testInfo, 'bell-unread');
  await bell.click();
  await expect(
    page.getByRole('region', { name: 'Центр уведомлений' }).getByRole('heading', {
      level: 1,
      name: 'Уведомления',
    }),
  ).toBeVisible();
  await capture(page, testInfo, 'notification-list');
  await page.getByRole('button', { name: /Письмо ждёт одобрения/u }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Уведомление' })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Письмо ждёт одобрения' }),
  ).toBeVisible();
  await capture(page, testInfo, 'notification-detail');
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(
    page.getByRole('region', { name: 'Центр уведомлений' }).getByRole('heading', {
      level: 1,
      name: 'Уведомления',
    }),
  ).toBeVisible();
});

test('notification settings opens the account notifications section', async ({
  page,
}, testInfo) => {
  await openToday(page);
  await page.getByRole('button', { name: 'Центр уведомлений, 3 непрочитанных' }).click();
  if (testInfo.project.name === 'desktop-1440') {
    await page
      .getByRole('dialog', { name: 'Уведомления' })
      .getByRole('button', { name: 'Настроить уведомления' })
      .click();
  } else {
    await page.getByRole('button', { name: 'Настроить уведомления' }).click();
  }
  await expect(page.getByRole('heading', { level: 3, name: 'Уведомления' })).toBeVisible();
});

test('empty notifications show the candidate-owned empty state', async ({ page }, testInfo) => {
  await openToday(page, { empty: true });
  await page.getByRole('button', { name: 'Центр уведомлений' }).click();
  if (testInfo.project.name === 'desktop-1440') {
    await page.getByRole('link', { name: 'Все уведомления' }).click();
  }
  await expect(
    page.getByRole('region', { name: 'Центр уведомлений' }).getByRole('heading', {
      level: 1,
      name: 'Уведомления',
    }),
  ).toBeVisible();
  await expect(page.getByText(/Новых уведомлений нет/u)).toBeVisible();
  await capture(page, testInfo, 'notification-empty');
});

test('loading and API errors keep recovery actions reachable', async ({ page }, testInfo) => {
  const failGetAt = testInfo.project.name === 'desktop-1440' ? 3 : 2;
  await openToday(page, { failGetAt, delayGetAt: failGetAt });
  await page.getByRole('button', { name: 'Центр уведомлений, 3 непрочитанных' }).click();
  if (testInfo.project.name === 'desktop-1440') {
    await page.getByRole('link', { name: 'Все уведомления' }).click();
  }
  await expect(page.getByText('Загружаем уведомления…')).toBeVisible();
  await capture(page, testInfo, 'notification-loading');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить уведомления');
  await capture(page, testInfo, 'notification-error');
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Сегодня' })).toBeVisible();
});

test('partial pages keep prior rows and load more notifications on request', async ({
  page,
}, testInfo) => {
  const items = Array.from({ length: 25 }, (_, index) =>
    notification(
      `notice-many-${index + 1}`,
      'employer_reply',
      `Ответ работодателя ${index + 1}`,
      notificationTimestamp(index < 10 ? 0 : 3, 9),
      null,
      'Напомнить рекрутеру',
      '/app?view=responses',
    ),
  );
  await openToday(page, { items, pageSize: 10, failNextPageOnce: true });
  await page.getByRole('button', { name: 'Центр уведомлений, 25 непрочитанных' }).click();
  if (testInfo.project.name === 'desktop-1440') {
    await page.getByRole('link', { name: 'Все уведомления' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Сегодня', level: 2 })).toBeVisible();
  await expect(page.getByText('Ответ работодателя 10')).toBeVisible();
  await page.getByRole('button', { name: 'Загрузить ещё' }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить ещё уведомления');
  await capture(page, testInfo, 'notification-partial');
  await page.getByRole('button', { name: 'Повторить' }).click();
  await page.getByRole('button', { name: 'Загрузить ещё' }).click();
  await expect(page.getByText('Ответ работодателя 25')).toBeVisible();
  await capture(page, testInfo, 'notification-many');
});

test('interview reminder updates the candidate application', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'reminder action only');
  const reminderApi = createReminderApi();
  await openToday(page, { items: [INTERVIEW_NOTICE], applicationHandler: reminderApi.handler });
  await page.getByRole('button', { name: 'Центр уведомлений, 1 непрочитанных' }).click();
  await page.getByRole('link', { name: 'Все уведомления' }).click();
  await page.getByRole('button', { name: /Скоро интервью/u }).click();
  await page.getByRole('button', { name: 'Напомнить за день' }).click();
  await expect(page.getByRole('status')).toContainText('Напоминание установлено');
  expect(reminderApi.reminder()?.followUpDueAt).toBe('2026-10-14T12:00:00.000Z');
});
