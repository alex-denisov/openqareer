import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

test.describe('B340 stage consultant', () => {
  test('header outline button and vacancy card discuss button open stage consultant and send stage/subject', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'desktop only');
    await mockSignedInCabinet(page);

    let sentTurnPayload: {
      stage?: string;
      subject?: { kind: string; id: string };
      content?: string;
    } | null = null;

    await page.route('**/api/v1/coach/turn*', async (route) => {
      const data = route.request().postDataJSON();
      sentTurnPayload = data;
      await route.fulfill({
        json: {
          data: {
            message: 'Отличная вакансия! Давайте разберём её ключевые требования.',
            phase: 'vacancies',
            memoryCandidates: [],
            nextQuestion: null,
            completeness: { known: [], unknown: [] },
            safety: { needsHuman: false, reason: null },
            actionProposals: [],
          },
        },
      });
    });

    // 1. Desktop 1440
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    // Verify header button on Today stage opens Today consultant
    const headerAskBtn = page.getByRole('button', { name: 'Спросить консультанта' });
    await expect(headerAskBtn).toBeVisible();
    await headerAskBtn.click();

    const expertPanel = page.locator('aside.career-expert-panel');
    await expect(expertPanel).toBeVisible();
    await expect(expertPanel.locator('header strong')).toHaveText('Консультант · Сегодня');
    await page.getByRole('button', { name: 'Закрыть карьерного консультанта' }).click();
    await expect(expertPanel).not.toBeVisible();

    // Navigate to Vacancies
    await page
      .locator('aside#career-rail nav')
      .getByRole('button', { name: 'Вакансии', exact: true })
      .click();
    await expect(page.locator('.vac-list-item').first()).toBeVisible();

    // Verify header button on Vacancies stage
    await expect(headerAskBtn).toBeVisible();

    // Expand the first vacancy row
    await page.locator('.vac-list-item').first().click();

    // Click «Обсудить с консультантом»
    const discussBtn = page
      .locator('.vac-list-item')
      .first()
      .getByRole('button', { name: 'Обсудить с консультантом' });
    await expect(discussBtn).toBeVisible();
    await discussBtn.click();

    // Verify panel header, subtitle and static initial replica
    await expect(expertPanel).toBeVisible();
    await expect(expertPanel.locator('header strong')).toHaveText('Консультант · Вакансии');
    await expect(expertPanel.locator('header small')).toContainText(/^О вакансии:/);
    await expect(expertPanel.locator('.career-dialogue-turn.is-assistant')).toContainText(
      'Выберите вакансию — сравню её требования с вашим опытом и скажу, где пробелы.',
    );

    await page.screenshot({ path: 'output/playwright/B340/vacancies-panel-1440.png' });

    // Send a question in the panel
    const input = page.locator('#career-expert-input');
    await input.fill('Что думаешь об этой вакансии?');
    await page.getByRole('button', { name: 'Отправить вопрос' }).click();

    // Verify reply rendered and payload verified
    await expect(
      expertPanel.locator('text=Отличная вакансия! Давайте разберём её ключевые требования.'),
    ).toBeVisible();
    expect(sentTurnPayload).not.toBeNull();
    expect(sentTurnPayload?.stage).toBe('vacancies');
    expect(sentTurnPayload?.subject?.kind).toBe('vacancy');
    expect(typeof sentTurnPayload?.subject?.id).toBe('string');
    expect(sentTurnPayload?.content).toBe('Что думаешь об этой вакансии?');

    // 2. Viewport 1176
    await page.setViewportSize({ width: 1176, height: 900 });
    await page.screenshot({ path: 'output/playwright/B340/vacancies-panel-1176.png' });

    // 3. Viewport 390
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'output/playwright/B340/vacancies-panel-390.png' });
  });
});
