import { expect, test, type Page } from '@playwright/test';

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
      .getByRole('button', { name: 'Управление' })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: /maria/ })).toBeVisible();
  });

  test('a signed-in candidate is refused without being told to sign in again', async ({ page }) => {
    await stubSession(page, CANDIDATE);
    let directoryCalls = 0;
    await page.route('**/api/v1/admin/users*', async (route) => {
      directoryCalls += 1;
      await route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } });
    });

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);

    await expect(page.getByText('Этот аккаунт не администратор')).toBeVisible();
    await expect(page.locator('.admin-table')).toHaveCount(0);
    // A refused surface must not even ask for the data it cannot have.
    expect(directoryCalls).toBe(0);
  });

  test('an anonymous visitor is sent to the door that actually opens', async ({ page }) => {
    await stubSession(page, null);

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await waitForLiveApp(page);

    await expect(page.getByText('Нужен вход под учётной записью администратора')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Вернуться в кабинет' })).toHaveAttribute(
      'href',
      '/',
    );
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

  test('the console fits both required viewports without sideways scrolling', async ({ page }) => {
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

    await expect(page.getByRole('status')).toContainText('В очереди');
    await expect(page.getByRole('status')).toContainText('Обслуживатель заберёт запрос');
    await page.getByRole('button', { name: 'Синхронизировать' }).click();
    await expect(page.getByRole('status')).toContainText('В очереди');
  });
});
