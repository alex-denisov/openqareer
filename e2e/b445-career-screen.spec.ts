import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { CAREER_FIXTURE_PROPOSED_ROLES } from '../src/features/career-map/careerMockData';

async function openCareer(page: Page): Promise<void> {
  await mockSignedInCabinet(page, {
    careerRoles: { roles: CAREER_FIXTURE_PROPOSED_ROLES, acceptedTitle: 'Head of Engineering' },
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('openqareer_session_token', 'synthetic-b445-session');
  });
  await page.goto('/app?view=career', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('career-screen')).toBeVisible({ timeout: 15_000 });
}

function role(page: Page, title: string) {
  return page.locator('details.career-role-item').filter({ hasText: title });
}

test.describe('B445: «Карьера» по макету 3', () => {
  test('1440: роль с проверенными навыками и гипотеза — блоки и кнопки по статусу', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop 1440 only');
    await openCareer(page);

    await expect(
      page.getByRole('heading', { level: 2, name: 'Условия и география' }),
    ).toBeVisible();
    await expect(page.getByText('600–780 тыс. ₽ · 88 вакансий · 05.10')).toBeVisible();
    await expect(
      page.getByText('вилка по 94 вакансиям с зарплатой, 05.10', { exact: false }),
    ).toBeVisible();

    const director = role(page, 'Director of Engineering');
    await expect(
      director.getByRole('heading', { name: 'Чего не хватает для этой роли' }),
    ).toBeVisible();
    await expect(
      director.getByRole('button', { name: 'Дозаполнить с консультантом' }),
    ).toBeVisible();
    await expect(director.getByRole('button', { name: 'Открыть вакансии роли' })).toBeVisible();

    const cto = role(page, 'CTO в финтехе');
    await cto.locator('summary').click();
    await expect(cto.getByRole('heading', { name: 'Пока неизвестно' })).toBeVisible();
    await expect(cto.getByRole('heading', { name: 'Что даст проверка навыков' })).toBeVisible();
    await expect(cto.getByRole('button', { name: 'Проверить навыки' })).toBeVisible();
    await expect(cto.getByRole('button', { name: 'Обсудить с консультантом' })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });

  test('1440: «Отклонить роль» сохраняется и переживает перезагрузку', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop 1440 only');
    await openCareer(page);
    const cto = role(page, 'CTO в финтехе');
    await cto.locator('summary').click();
    await cto.getByRole('button', { name: 'Отклонить роль' }).click();
    await cto.getByRole('button', { name: 'Да, отклонить' }).click();
    await expect(role(page, 'CTO в финтехе')).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('career-screen')).toBeVisible({ timeout: 15_000 });
    await expect(role(page, 'Director of Engineering')).toBeVisible();
    await expect(role(page, 'CTO в финтехе')).toHaveCount(0);
  });

  test('1440: предложение консультанта «Принять» открывает роль для поиска', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop 1440 only');
    await openCareer(page);
    await role(page, 'Director of Engineering')
      .getByRole('button', { name: 'Дозаполнить с консультантом' })
      .click();
    const offer = page.getByTestId('career-role-offer');
    await expect(offer).toContainText('Принять роль Director of Engineering');
    await expect(offer).toContainText('88 вакансий');
    await offer.getByRole('button', { name: 'Принять' }).click();
    // «Стратегия» хранит одну выбранную роль: предложение переходит к следующей.
    await expect(offer).not.toContainText('Director of Engineering');
    // CPO 26.10: ступени «Открыта для поиска» нет — подборка идёт по всем ролям.
    await expect(
      role(page, 'Director of Engineering').locator('summary').getByText('Навыки проверены'),
    ).toBeVisible();
    await expect(page.getByText('Открыта для поиска')).toHaveCount(0);
  });

  test('390: список ролей со строкой-действием → push-экран роли', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Mobile 390 only');
    await openCareer(page);
    await expect(page.getByRole('heading', { name: 'Мои роли на рынке · 4' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Условия поиска' })).toBeVisible();
    await page.getByRole('button', { name: /CTO в финтехе/ }).click();
    const push = page.locator('[data-mv="role:role-cto-финтехе"]');
    await expect(push.getByRole('heading', { name: 'Пока неизвестно' })).toBeVisible();
    await expect(push.getByRole('button', { name: 'Проверить навыки' })).toBeVisible();
    await push.getByRole('button', { name: 'Назад' }).click();
    await expect(page.getByRole('heading', { name: 'Условия поиска' })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
});
