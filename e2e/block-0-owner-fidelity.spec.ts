import { expect, test } from '@playwright/test';
import { advanceFirstRunSource } from './helpers/advance-first-run-source.mjs';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

test('first run preserves desktop step context and mobile screens, with a real city sheet', async ({
  page,
}, info) => {
  await mockSignedInCabinet(page);
  await page.route('**/api/v1/candidate/workspace', (route) =>
    route.fulfill({ json: { data: null } }),
  );
  await page.addInitScript(() =>
    localStorage.setItem('openqareer_session_token', 'synthetic-block0-owner'),
  );
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const wizard = page.getByTestId('first-run-wizard');
  await expect(wizard).toBeVisible();
  const desktop = info.project.name === 'desktop-1440';
  if (desktop) {
    await expect(wizard.locator('.first-run-stage-card')).toHaveCount(3);
    await expect(wizard.locator('[aria-disabled="true"]')).toHaveCount(2);
  }
  const goal = page.getByTestId('goal-textarea');
  await goal.fill('Хочу понять, на какие руководящие роли могу идти. Ищу активно.');
  await goal.click();
  if (desktop) {
    await page.getByRole('button', { name: /^Центр уведомлений/ }).click();
    await page.getByRole('link', { name: 'Все уведомления', exact: true }).click();
    await expect(wizard).not.toBeVisible();
    await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
    await expect(wizard).toBeVisible();
    await expect(goal).toHaveValue(
      'Хочу понять, на какие руководящие роли могу идти. Ищу активно.',
    );
    await goal.click();
  }
  expect(await goal.evaluate((element) => getComputedStyle(element).boxShadow)).toBe('none');
  await page.getByTestId('save-goal-btn').click();
  await expect(page.getByTestId('source-opt-linkedin')).toBeVisible();
  if (desktop) {
    const starter = page.getByRole('button', { name: 'Можно без LinkedIn?', exact: true });
    await expect(starter).toBeVisible();
    await starter.click();
    await expect(page.getByLabel('Сообщение карьерному консультанту')).toHaveValue(
      'Можно без LinkedIn?',
    );
    await page.getByLabel('Сообщение карьерному консультанту').fill('');
  }
  if (desktop) {
    await expect(wizard.locator('.first-run-stage-card')).toHaveCount(3);
    await expect(wizard.locator('[aria-disabled="true"]')).toHaveCount(1);
  }
  if (desktop) await expect(page.getByTestId('source-skip-btn')).toHaveCount(0);
  await advanceFirstRunSource(page, !desktop);
  if (desktop) {
    await expect(wizard.locator('.first-run-stage-card')).toHaveCount(3);
    await expect(wizard.locator('.first-run-stage-card.is-done')).toHaveCount(2);
  }
  const city = page.getByTestId('context-city-picker-btn');
  await city.click();
  const sheet = page.getByTestId('first-run-city-sheet');
  await expect(sheet).toBeVisible();
  if (!desktop) {
    expect(await sheet.evaluate((element) => element.parentElement === document.body)).toBe(true);
    const panel = await sheet.locator('.first-run-city-panel').boundingBox();
    expect(panel?.x).toBe(0);
    expect(panel?.width).toBe(390);
    expect(Math.abs(panel!.y + panel!.height - 844)).toBeLessThanOrEqual(1);
  }
  await page.getByTestId('city-item-Белград').click();
  await expect(city).toContainText('Белград');
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByTestId('context-format-select').locator('option:not([hidden])'),
  ).toHaveText(['Гибрид', 'Удалённо', 'Офис']);
  if (desktop)
    expect((await page.getByTestId('context-format-select').boundingBox())!.height).toBe(44);
  await page.getByTestId('context-format-select').selectOption('Удалённо');
  await expect(page.getByTestId('context-format-select')).toHaveValue('Удалённо');
  await city.click();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(city).toBeFocused();
});

test('queue discussion and mobile history have real controls', async ({ page }, info) => {
  await mockSignedInCabinet(page);
  await page.route('**/api/v1/candidate/consultant-history**', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            stage: 'today',
            firstPhrase: 'Сохранённая беседа',
            summary: null,
            lastMessageAt: '2026-10-16T09:00:00Z',
            openedAt: '2026-10-16T09:00:00Z',
            closedAt: null,
            messageCount: 1,
          },
        ],
      },
    }),
  );
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const panel = page.locator('.career-expert-panel');
  if (info.project.name === 'desktop-1440') {
    if (
      await panel
        .getByRole('button', { name: 'Свернуть консультанта в полосу', exact: true })
        .isVisible()
    )
      await panel
        .getByRole('button', { name: 'Свернуть консультанта в полосу', exact: true })
        .click();
    await page.locator('.career-today-queue-discuss').first().click();
    await expect(panel).not.toHaveClass(/consultant-strip/);
    for (const card of await page.locator('.career-today-funnel-list > li').all())
      expect(Math.abs((await card.boundingBox())!.height - 94.3)).toBeLessThanOrEqual(1);
    for (const track of await page.locator('.career-today-funnel-track').all())
      expect((await track.boundingBox())!.height).toBe(4);
  } else {
    // Лист 390: кнопка истории бесед в шапке (решение CPO 29.10, A4, заменяет решение 20.10).
    await page.getByRole('button', { name: 'Консультант: открыть', exact: true }).click();
    await expect(panel).toHaveAttribute('data-mobile-expanded', 'true');
    await expect(panel.getByRole('button', { name: 'История бесед', exact: true })).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Развернуть или свернуть консультанта', exact: true }),
    ).toBeVisible();
  }
});
