import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * B089 — the administrator surface. The owner asked for an admin account for
 * an admin screen, so the screen has to exist, has to be reachable by its own
 * URL, and has to refuse everyone else. A deep link is a server fact and a
 * refusal is a runtime fact, so both are asserted in a real browser.
 */

const ADMINISTRATOR = {
  username: 'admin.test',
  email: 'admin@example.com',
  displayName: 'Администратор',
  role: 'admin' as const,
  isTest: false,
  candidateId: null,
};

const CANDIDATE = {
  username: 'candidate.test',
  email: 'candidate@example.com',
  displayName: 'Кандидат',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-1',
};

const DIRECTORY = {
  total: 2,
  users: [
    {
      id: 'user-2',
      username: 'maria',
      role: 'candidate',
      isTest: false,
      email: 'maria@example.com',
      displayName: 'Мария Иванова',
      candidateId: 'candidate-2',
      createdAt: '2026-08-16T10:15:00.000Z',
      activeSessions: 1,
      lastSeenAt: '2026-08-17T09:00:00.000Z',
    },
    {
      id: 'user-1',
      username: ADMINISTRATOR.username,
      role: 'admin',
      isTest: false,
      email: ADMINISTRATOR.email,
      displayName: ADMINISTRATOR.displayName,
      candidateId: null,
      createdAt: '2026-08-01T08:00:00.000Z',
      activeSessions: 2,
      lastSeenAt: '2026-08-17T12:30:00.000Z',
    },
  ],
};

async function stubSession(page: Page, session: unknown): Promise<void> {
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({ json: { data: session } });
  });
}

async function waitForLiveApp(page: Page): Promise<void> {
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
}

test.describe('B089 administrator console', () => {
  test('an administrator opens the directory at its own URL', async ({ page }) => {
    await stubSession(page, ADMINISTRATOR);
    await page.route('**/api/v1/admin/users*', async (route) => {
      await route.fulfill({ json: { data: DIRECTORY } });
    });

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);

    await expect(page.getByRole('heading', { name: 'Учётные записи' })).toBeVisible();
    await expect(page.getByText('Показано 2 из 2')).toBeVisible();
    await expect(page.getByText('Мария Иванова')).toBeVisible();

    // The console is its own surface: no candidate navigation may appear here.
    await expect(page.locator('.career-shell')).toHaveCount(0);

    await page
      .getByRole('row', { name: /Мария Иванова/ })
      .getByRole('button', { name: 'Управление аккаунтом maria' })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: /maria/ })).toBeVisible();
  });

  test('a signed-in candidate is redirected out of admin without loading admin data', async ({
    page,
  }) => {
    await stubSession(page, CANDIDATE);
    let directoryCalls = 0;
    await page.route('**/api/v1/admin/users*', async (route) => {
      directoryCalls += 1;
      await route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } });
    });

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('.admin-console')).toHaveCount(0);
    await expect(page.getByText('Аккаунты LinkedIn')).toHaveCount(0);
    // A refused surface must not even ask for the data it cannot have.
    expect(directoryCalls).toBe(0);
  });

  test('an anonymous visitor is sent to the login door without rendering admin', async ({
    page,
  }) => {
    await stubSession(page, null);

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('.admin-console')).toHaveCount(0);
  });

  test('a failed directory explains itself and offers a retry', async ({ page }) => {
    await stubSession(page, ADMINISTRATOR);
    let attempts = 0;
    await page.route('**/api/v1/admin/users*', async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({
          status: 503,
          json: { error: { code: 'unavailable', message: 'База недоступна.' } },
        });
        return;
      }
      await route.fulfill({ json: { data: DIRECTORY } });
    });

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);

    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByText('Показано 2 из 2')).toBeVisible();
  });

  test('the console fits both required viewports without sideways scrolling', async ({
    page,
  }, testInfo) => {
    await stubSession(page, ADMINISTRATOR);
    await page.route('**/api/v1/admin/users*', async (route) => {
      await route.fulfill({ json: { data: DIRECTORY } });
    });

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    await expect(page.getByRole('heading', { name: 'Учётные записи' })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const tableOverflow = await page
      .locator('.admin-table-scroll')
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(tableOverflow).toBeLessThanOrEqual(0);
    if (testInfo.project.name === 'desktop-1440') {
      for (const width of [900, 1280]) {
        await page.setViewportSize({ width, height: 860 });
        const inner = await page
          .locator('.admin-table-scroll')
          .evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(inner, `user table overflow at ${width}px`).toBeLessThanOrEqual(0);
      }
    }
  });

  test('the source screen names a queued manual sync instead of claiming it is complete', async ({
    page,
  }) => {
    await stubSession(page, ADMINISTRATOR);
    await page.route('**/api/v1/admin/users*', async (route) => {
      await route.fulfill({ json: { data: DIRECTORY } });
    });
    await page.route('**/api/v1/admin/vacancy-sources?offset=*', async (route) => {
      await route.fulfill({
        json: {
          data: {
            items: [
              {
                id: 'source-test',
                name: 'Тестовая площадка',
                type: 'rss',
                enabled: true,
                targetUrl: 'https://example.com/jobs',
                refreshIntervalMinutes: 60,
                itemsFoundTotal: 12,
                itemsActiveTotal: 8,
                manualSync: { status: 'queued' },
              },
            ],
            total: 1,
            offset: 0,
            nextOffset: null,
          },
        },
      });
    });
    await page.route('**/api/v1/admin/vacancy-sources/source-test/sync', async (route) => {
      await route.fulfill({ status: 202, json: { data: { queued: true } } });
    });

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    await page.getByRole('button', { name: 'Источники вакансий' }).click();

    await page.getByRole('button', { name: /Тестовая площадка/ }).click();
    await expect(page.getByRole('status')).toContainText('В очереди');
    await expect(page.getByRole('status')).toContainText('Обслуживатель заберёт запрос');
    await page.getByRole('button', { name: 'Синхронизировать' }).click();
    await expect(page.getByRole('status')).toContainText('В очереди');
  });

  test('the LinkedIn pool shows the complete identifier and names the desktop login boundary', async ({
    page,
  }) => {
    await stubSession(page, ADMINISTRATOR);
    await page.route('**/api/v1/admin/users*', async (route) => {
      await route.fulfill({ json: { data: DIRECTORY } });
    });
    await page.route('**/api/v1/admin/linkedin/accounts?*', async (route) => {
      await route.fulfill({
        json: {
          data: {
            total: 1,
            offset: 0,
            nextOffset: null,
            accounts: [
              {
                id: '2e6f2b8a-1e84-4f07-9c6d-f8b5a4e2e4a1',
                adminLabel: 'Основной пул',
                emailLogin: 'pool-admin@example.test',
                providerAccountMarker: 'marker-1',
                profileIsolationId: 'profile-1',
                state: 'login_required',
                lastVerifiedAt: null,
                lastHeartbeatAt: null,
                lastFailureCode: 'login_required',
                leaseUntil: null,
                capabilityVerdict: 'not_configured',
                revision: 0,
                createdAt: '2026-09-22T00:00:00.000Z',
                updatedAt: '2026-09-22T00:00:00.000Z',
              },
            ],
          },
        },
      });
    });
    await page.route('**/api/v1/admin/linkedin/accounts/*/session', async (route) => {
      await route.fulfill({
        status: 202,
        json: {
          data: {
            account: { state: 'user_action_required' },
            lease: {
              accountId: '2e6f2b8a-1e84-4f07-9c6d-f8b5a4e2e4a1',
              handle: 'lhs_synthetic_handle_for_e2e_123456789012345678901234567890',
              expiresAt: '2026-09-22T00:15:00.000Z',
              transport: 'desktop',
              webRemote: false,
            },
          },
        },
      });
    });

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    await page.getByRole('button', { name: 'Аккаунты LinkedIn' }).click();

    await expect(page.getByText('pool-admin@example.test')).toBeVisible();
    await page.getByRole('button', { name: /pool-admin@example.test/ }).click();
    await page.getByRole('button', { name: 'Войти в LinkedIn' }).click();
    await expect(page.getByRole('alert')).toContainText('приложении OpenQareer Desktop');
  });

  test('a new LinkedIn account appears in the list even when an old filter was active', async ({
    page,
  }) => {
    await stubSession(page, ADMINISTRATOR);
    await page.route('**/api/v1/admin/users*', (route) =>
      route.fulfill({ json: { data: DIRECTORY } }),
    );
    const accounts: Array<Record<string, unknown>> = [];
    await page.route('**/api/v1/admin/linkedin/accounts?*', (route) =>
      route.fulfill({
        json: {
          data: { total: accounts.length, accounts, offset: 0, nextOffset: null },
        },
      }),
    );
    await page.route('**/api/v1/admin/linkedin/accounts', async (route) => {
      const body = route.request().postDataJSON() as { emailLogin: string };
      const created = {
        id: '2e6f2b8a-1e84-4f07-9c6d-f8b5a4e2e4a1',
        adminLabel: body.emailLogin,
        emailLogin: body.emailLogin,
        providerAccountMarker: null,
        profileIsolationId: 'profile-1',
        state: 'login_required',
        lastVerifiedAt: null,
        lastHeartbeatAt: null,
        lastFailureCode: 'login_required',
        leaseUntil: null,
        capabilityVerdict: 'not_configured',
        revision: 0,
        createdAt: '2026-09-22T00:00:00.000Z',
        updatedAt: '2026-09-22T00:00:00.000Z',
      };
      accounts.push(created);
      await route.fulfill({ status: 201, json: { data: created } });
    });
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    await page.getByRole('button', { name: 'Аккаунты LinkedIn' }).click();
    await page.getByRole('searchbox', { name: 'Поиск аккаунта' }).fill('старый');
    await page.locator('.admin-linkedin-create summary').click();
    await page
      .getByRole('textbox', { name: 'Идентификатор сессии' })
      .fill('new-account@example.test');
    await page
      .locator('.admin-linkedin-add')
      .getByRole('button', { name: 'Добавить аккаунт' })
      .click();
    await expect(page.getByRole('searchbox', { name: 'Поиск аккаунта' })).toHaveValue('');
    await expect(page.getByRole('button', { name: /new-account@example.test/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Войти в LinkedIn' })).toBeVisible();
  });

  test('all five operator screens keep their hierarchy and fit the viewport', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await stubSession(page, ADMINISTRATOR);
    await page.route('**/api/v1/admin/users*', (route) =>
      route.fulfill({ json: { data: DIRECTORY } }),
    );
    await page.route('**/api/v1/admin/vacancies?*', (route) =>
      route.fulfill({
        json: {
          data: {
            total: 2,
            items: [
              {
                id: 'vacancy-1',
                fingerprint: 'f1',
                title: 'Руководитель продукта',
                company: 'Тестовая компания',
                location: 'Москва',
                isRemote: true,
                salary: { from: 250000, to: 350000, currency: 'RUB' },
                descriptionSnippet: 'Развитие продукта',
                requiredSkills: ['Стратегия'],
                skillCount: 1,
                url: 'https://example.com/jobs/1',
                provenance: {
                  sourceType: 'rss',
                  sourceId: 'source-test',
                  observedAt: '2026-09-22T10:00:00.000Z',
                },
                publishedAt: '2026-09-22T09:00:00.000Z',
                status: 'active',
              },
              {
                id: 'vacancy-2',
                fingerprint: 'f2',
                title: 'Директор по операциям',
                company: 'Другая компания',
                location: 'Санкт-Петербург',
                isRemote: false,
                descriptionSnippet: 'Операционное управление',
                requiredSkills: [],
                skillCount: 0,
                url: 'https://example.com/jobs/2',
                provenance: {
                  sourceType: 'rss',
                  sourceId: 'source-test',
                  observedAt: '2026-09-21T10:00:00.000Z',
                },
                publishedAt: '2026-09-21T09:00:00.000Z',
                status: 'active',
              },
            ],
            statsBySource: [{ sourceId: 'source-test', sourceName: 'Тестовая площадка', count: 2 }],
            offset: 0,
            nextOffset: null,
          },
        },
      }),
    );
    await page.route('**/api/v1/admin/vacancy-sources?offset=*', (route) =>
      route.fulfill({
        json: {
          data: {
            items: [
              {
                id: 'source-test',
                name: 'Тестовая площадка',
                type: 'rss',
                enabled: true,
                targetUrl: 'https://example.com/jobs',
                refreshIntervalMinutes: 60,
                itemsFoundTotal: 12,
                itemsActiveTotal: 8,
                lastStatus: 'healthy',
              },
            ],
            total: 1,
            offset: 0,
            nextOffset: null,
          },
        },
      }),
    );
    await page.route('**/api/v1/admin/hh-crawl-filter', (route) =>
      route.fulfill({ json: { data: null } }),
    );
    await page.route('**/api/v1/admin/audit?*', (route) =>
      route.fulfill({
        json: {
          data: {
            total: 2,
            records: [
              {
                id: 'event-1',
                actorUserId: 'admin-1',
                actorUsername: 'admin.test',
                action: 'change_user_role',
                subjectUserId: 'candidate-1',
                subjectUsername: 'candidate.test',
                detail: 'Роль: candidate → admin',
                createdAt: '2026-09-22T10:00:00.000Z',
              },
              {
                id: 'event-2',
                actorUserId: 'admin-1',
                actorUsername: 'admin.test',
                action: 'block_user',
                subjectUserId: 'candidate-2',
                subjectUsername: 'other.test',
                detail: 'Блокировка после обращения',
                createdAt: '2026-09-21T10:00:00.000Z',
              },
            ],
            offset: 0,
            nextOffset: null,
          },
        },
      }),
    );
    await page.route('**/api/v1/admin/linkedin/accounts?*', (route) =>
      route.fulfill({
        json: {
          data: {
            total: 1,
            accounts: [
              {
                id: '2e6f2b8a-1e84-4f07-9c6d-f8b5a4e2e4a1',
                adminLabel: 'Основной пул',
                emailLogin: 'pool-admin@example.test',
                providerAccountMarker: null,
                profileIsolationId: 'profile-1',
                state: 'login_required',
                lastVerifiedAt: null,
                lastHeartbeatAt: null,
                lastFailureCode: 'login_required',
                leaseUntil: null,
                capabilityVerdict: 'not_configured',
                revision: 0,
                createdAt: '2026-09-22T00:00:00.000Z',
                updatedAt: '2026-09-22T00:00:00.000Z',
              },
            ],
            offset: 0,
            nextOffset: null,
          },
        },
      }),
    );

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);
    const screens = [
      ['users', 'Учётные записи'],
      ['vacancies', 'База вакансий'],
      ['sources', 'Источники вакансий'],
      ['audit', 'Журнал аудита', 'Журнал действий'],
      ['linkedin', 'Аккаунты LinkedIn'],
    ] as const;
    const directory = 'output/playwright/admin-redesign';
    mkdirSync(directory, { recursive: true });
    for (const [tab, navName, pageTitle] of screens) {
      await page
        .getByRole('navigation', { name: 'Разделы администратора' })
        .getByRole('button', { name: navName })
        .click();
      await expect(
        page.getByRole('heading', { name: pageTitle ?? navName, level: 1 }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${directory}/${testInfo.project.name}-${tab}.png` });
      if (tab === 'users') {
        const sorted = page.waitForRequest(
          (request) =>
            request.url().includes('/api/v1/admin/users?') && request.url().includes('sortBy=name'),
        );
        if (testInfo.project.name === 'mobile-390') {
          await page
            .locator('.admin-directory-sort-mobile')
            .getByRole('button', { name: 'Имя', exact: true })
            .click();
        } else {
          await page.getByRole('columnheader', { name: 'Аккаунт' }).getByRole('button').click();
        }
        await sorted;
        const filtered = page.waitForRequest(
          (request) =>
            request.url().includes('/api/v1/admin/users?') && request.url().includes('role=admin'),
        );
        await page.getByLabel('Роль').selectOption('admin');
        await filtered;
      }
      if (tab === 'vacancies') {
        await page.getByRole('button', { name: 'Компания', exact: true }).click();
        await expect(page.locator('.admin-vacancy-row').first()).toContainText('Другая компания');
        await page.locator('.admin-source-picker summary').click();
        await page.getByRole('searchbox', { name: 'Найти источник' }).fill('Тестовая');
        await expect(
          page
            .locator('.admin-source-picker__options')
            .getByRole('button', { name: /Тестовая площадка/ }),
        ).toBeVisible();
        await page.getByRole('searchbox', { name: 'Найти источник' }).press('Escape');
        await expect(page.locator('.admin-source-picker')).not.toHaveAttribute('open', '');
      }
      if (tab === 'sources') {
        await page.getByRole('button', { name: /Тестовая площадка/ }).click();
        await expect(page.getByText('https://example.com/jobs')).toBeVisible();
        await page.screenshot({ path: `${directory}/${testInfo.project.name}-sources-open.png` });
        await page.getByRole('searchbox', { name: 'Найти источник' }).fill('несуществующий');
        await expect(page.getByText('Источники по выбранным условиям не найдены.')).toBeVisible();
      }
      if (tab === 'audit') {
        await page.locator('.admin-audit-row summary').first().click();
        await expect(page.getByText('Роль: candidate → admin')).toBeVisible();
        await page.screenshot({ path: `${directory}/${testInfo.project.name}-audit-open.png` });
        const filtered = page.waitForRequest(
          (request) =>
            request.url().includes('/api/v1/admin/audit?') &&
            request.url().includes('action=change_user_role'),
        );
        await page.getByRole('button', { name: 'Роли', exact: true }).click();
        await filtered;
      }
      if (tab === 'linkedin') {
        await page.getByRole('button', { name: /pool-admin@example.test/ }).click();
        await expect(page.getByRole('button', { name: 'Войти в LinkedIn' })).toBeVisible();
        await page.screenshot({ path: `${directory}/${testInfo.project.name}-linkedin-open.png` });
        await page.getByRole('searchbox', { name: 'Поиск аккаунта' }).fill('несуществующий');
        await expect(page.getByText('Аккаунты по выбранным условиям не найдены.')).toBeVisible();
      }
    }
  });
});
