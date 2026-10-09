import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { todaySnapshot } from './fixtures/readabilityWorkspace';

test.describe('B397: Search Momentum Widget', () => {
  test('renders momentum metrics on desktop and mobile without horizontal overflow (Criterion 6)', async ({
    page,
  }) => {
    await mockSignedInCabinet(page);
    await page.goto('/app');

    const widget = page.locator('[data-testid="search-momentum-widget"]');
    await expect(widget).toBeVisible();

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
  }) => {
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

    await page.goto('/app');
    const emptyNotice = page.locator('[data-testid="search-momentum-empty"]');
    await expect(emptyNotice).toBeVisible();
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
  }) => {
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

    await page.goto('/app');
    const hint = page.locator('[data-testid="search-momentum-hint"]');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('30 откликов без интервью — возможно, стоит сменить тактику');

    const button = page.locator('[data-testid="search-momentum-consultant-action"]');
    await expect(button).toBeVisible();
    await button.click();
  });
});
