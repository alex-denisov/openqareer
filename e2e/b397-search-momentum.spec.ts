import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { todaySnapshot } from './fixtures/readabilityWorkspace';
import { waitForCareerShell } from './helpers/waitForCareerShell';

test.describe('B397: Search Momentum Widget', () => {
  test('renders compact momentum on mobile and the S10 funnel on desktop (Criterion 6)', async ({
    page,
  }, testInfo) => {
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    const widget = page.locator('[data-testid="search-momentum-widget"]');
    if (testInfo.project.name === 'desktop-1440') {
      await expect(widget).toBeHidden();
      await expect(page.getByRole('region', { name: 'Воронка за 30 дней' })).toBeVisible();
      return;
    }
    await expect(widget).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('[data-testid="search-momentum-card-applied"]')).toContainText(
      'Подтверждённые отклики',
    );
    await expect(page.locator('[data-testid="search-momentum-card-views"]')).toContainText(
      'нет данных',
    );
    await expect(page.locator('[data-testid="search-momentum-card-screenings"]')).toContainText(
      'нет данных',
    );
    await expect(page.locator('[data-testid="search-momentum-card-interviews"]')).toContainText(
      'Интервью',
    );

    const btn30d = page.locator('[data-testid="search-momentum-toggle-30d"]');
    await expect(btn30d).toBeVisible();
    await btn30d.click();
    await expect(btn30d).toHaveAttribute('aria-pressed', 'true');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const isMobile = (page.viewportSize()?.width ?? 1440) < 600;
    const shotPath = test
      .info()
      .outputPath(isMobile ? 'search-momentum-390.png' : 'search-momentum-1440.png');
    await page.screenshot({ path: shotPath, fullPage: true });
  });

  test('renders honest empty state when no confirmed applications exist (Criterion 3)', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Desktop uses the S10 funnel.');
    await mockSignedInCabinet(page);
    await page.route('**/api/v1/candidate/today*', async (route) => {
      const emptyMomentum = {
        calculatedAt: '2026-10-09T12:00:00.000Z',
        windows: {
          '7d': { applied: 0, views: 'unknown', screenings: 'unknown', interviews: 0 },
          '30d': { applied: 0, views: 'unknown', screenings: 'unknown', interviews: 0 },
        },
        burnoutNotice: false,
      };
      return route.fulfill({
        json: { data: { ...todaySnapshot, momentum: emptyMomentum } },
      });
    });

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    const emptyNotice = page.locator('[data-testid="search-momentum-empty"]');
    await expect(emptyNotice).toBeVisible({ timeout: 15_000 });
    await expect(emptyNotice).toHaveText(
      'Пока нет подтверждённых откликов. Когда отклики будут отправлены и подтверждены, здесь появятся цифры',
    );

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('shows burnout protection hint at 30 applications and 0 interviews (Criterion 4)', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Desktop uses the S10 funnel.');
    await mockSignedInCabinet(page);
    await page.route('**/api/v1/candidate/today*', async (route) => {
      const burnoutMomentum = {
        calculatedAt: '2026-10-09T12:00:00.000Z',
        windows: {
          '7d': { applied: 10, views: 'unknown', screenings: 'unknown', interviews: 0 },
          '30d': { applied: 30, views: 'unknown', screenings: 'unknown', interviews: 0 },
        },
        burnoutNotice: true,
      };
      return route.fulfill({
        json: { data: { ...todaySnapshot, momentum: burnoutMomentum } },
      });
    });

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    const hint = page.locator('[data-testid="search-momentum-hint"]');
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await expect(hint).toContainText('30 откликов без интервью — возможно, стоит сменить тактику');

    const button = page.locator('[data-testid="search-momentum-consultant-action"]');
    await expect(button).toBeVisible();
    await button.click();
  });
});
