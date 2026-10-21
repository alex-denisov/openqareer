import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { CAREER_FIXTURE_PROPOSED_ROLES } from '../src/features/career-map/careerMockData';

const SECOND_ROLE = 'CTO в финтехе';

async function openCareer(page: Page): Promise<void> {
  await mockSignedInCabinet(page, {
    careerRoles: { roles: CAREER_FIXTURE_PROPOSED_ROLES, acceptedTitle: 'Head of Engineering' },
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('openqareer_session_token', 'synthetic-b445-r1-session');
  });
  await page.goto('/app?view=career', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('career-screen')).toBeVisible({ timeout: 15_000 });
}

async function expectAssessmentOfSecondRole(page: Page): Promise<void> {
  const assessment = page.getByTestId('role-skill-assessment');
  await expect(assessment).toBeVisible();
  await expect(assessment).toContainText(SECOND_ROLE);
  await expect(page.getByText('Сначала выберите роль')).toHaveCount(0);
  await expect(page.getByTestId('career-screen')).toHaveCount(0);
}

test.describe('B445-r1: «Проверить навыки» у роли на «Карьере»', () => {
  test('1440: проверка этой роли заменяет экран, «Назад» — к той же роли', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop 1440 only');
    await openCareer(page);
    const role = page.locator('details.career-role-item').filter({ hasText: SECOND_ROLE });
    await role.locator('summary').click();
    await role.getByRole('button', { name: 'Проверить навыки' }).click();
    await expectAssessmentOfSecondRole(page);

    await page.getByRole('button', { name: 'Назад к карьере' }).click();
    await expect(page.getByTestId('career-screen')).toBeVisible();
    await expect(
      page.locator('details.career-role-item[open]').filter({ hasText: SECOND_ROLE }),
    ).toBeVisible();
  });

  test('390: проверка этой роли с push-экрана, «Назад» — на ту же роль', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Mobile 390 only');
    await openCareer(page);
    await page.getByRole('button', { name: new RegExp(SECOND_ROLE) }).click();
    const push = page.locator('[data-mv="role:role-cto-финтехе"]');
    await push.getByRole('button', { name: 'Проверить навыки' }).click();
    await expectAssessmentOfSecondRole(page);

    await page.getByRole('button', { name: 'Назад к карьере' }).click();
    await expect(push.getByRole('heading', { name: 'Пока неизвестно' })).toBeVisible();
  });
});
