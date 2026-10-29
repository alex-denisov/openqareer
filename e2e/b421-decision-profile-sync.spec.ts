import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

test('syncs a legacy decision profile once after sign-in', async ({ page }) => {
  const puts: string[] = [];
  page.on('request', (request) => {
    if (
      request.url().endsWith('/api/v1/candidate/decision-profile') &&
      request.method() === 'PUT'
    ) {
      puts.push(request.postData() ?? '');
    }
  });
  const unmatched = await mockSignedInCabinet(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('openqareer_session_token', 'synthetic-b421-session');
    window.localStorage.setItem(
      'openqareer.decision-profile.v1',
      JSON.stringify({
        citizenship: ['РФ'],
        taxStatus: 'Резидент РФ',
        languages: [],
        workFormats: ['remote_home'],
        salaryFloor: 350_000,
        salaryCurrency: 'RUB',
        cushionMonths: 4,
        hasFamily: false,
      }),
    );
  });

  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const profileNavigation =
    (page.viewportSize()?.width ?? 1440) <= 760
      ? page.getByRole('navigation', { name: 'Разделы' })
      : page.getByRole('navigation', { name: 'Разделы кабинета' });
  await profileNavigation.getByRole('button', { name: 'Профиль', exact: true }).click();
  await expect(
    page.locator(
      (page.viewportSize()?.width ?? 1440) <= 760
        ? '.career-profile-mobile'
        : '.career-profile-screen-view',
    ),
  ).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    // On 390 the preferences panel lives on the «Релокация» page (contacts hold only contacts, A9).
    await page
      .locator('.career-profile-mobile')
      .getByRole('button', { name: /^Релокация/u })
      .click();
  }
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('openqareer.decision-profile.v1:synced')))
    .toBe('1');

  expect(puts).toHaveLength(1);
  expect(JSON.parse(puts[0] ?? '{}')).toMatchObject({ salaryFloor: 350_000 });
  expect(unmatched).not.toContain('/api/v1/candidate/decision-profile');
});
