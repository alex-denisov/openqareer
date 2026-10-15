import { expect, type Page } from '@playwright/test';

const AUTOMATION_URL = '**/api/v1/candidate/automation';

/**
 * B486 mobile: «Отклики» has no section switch; automation opens from the
 * pending-approvals link, which exists only while approvals are waiting. The
 * spec fixtures start with an empty queue, so only the one count probe made by
 * the Responses screen is answered with a waiting approval; every later request
 * reaches the spec's own mock.
 */
export async function openAutomationMobile(page: Page): Promise<void> {
  let probed = false;
  const probe = async (route: import('@playwright/test').Route) => {
    if (probed || route.request().method() !== 'GET') return route.fallback();
    probed = true;
    return route.fulfill({ json: { data: { queueCounts: { pending_approval: 1 } } } });
  };
  await page.route(AUTOMATION_URL, probe);
  await page.locator('button[aria-label="Отклики"]:visible').first().click();
  const link = page.getByRole('button', { name: /^Автоматизация, .* ждут одобрения$/ });
  await expect(link).toBeVisible();
  await page.unroute(AUTOMATION_URL, probe);
  await link.click();
}
