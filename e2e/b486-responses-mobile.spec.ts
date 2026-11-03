import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  APPLICATIONS,
  application,
  openB486Responses,
  seedB486Workspace,
  stubB486Session,
} from './helpers/b486-responses-fixture';

test.describe('B486 mobile responses', () => {
  test('has one header and opens the consultant sheet from the icon', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'B486 mobile layout acceptance');
    await stubB486Session(page);
    await seedB486Workspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openB486Responses(page);

    await expect(
      page.getByRole('banner').getByRole('heading', { name: 'Отклики', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('heading', { name: 'Отклики', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Спросить консультанта', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Консультант: открыть' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Консультант/ })).toHaveCount(1);

    await page.getByRole('button', { name: 'Консультант: открыть' }).click();
    await expect(page.locator('.career-expert-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.career-expert-panel')).toBeHidden();
  });

  test('filters trap focus, close on Escape, and return focus to the trigger', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'B486 mobile filter acceptance');
    await stubB486Session(page);
    await seedB486Workspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openB486Responses(page);

    const trigger = page.getByRole('button', { name: 'Фильтры', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Фильтры' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Канал')).toBeVisible();
    await expect(dialog.getByLabel('Период')).toBeVisible();
    await expect(dialog.getByLabel('Сортировка')).toBeVisible();

    const applyButton = dialog.getByRole('button', { name: 'Показать', exact: true });
    await applyButton.focus();
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('applies the selected channel, period, and sort mode', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'B486 mobile filter application');
    await stubB486Session(page);
    await seedB486Workspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openB486Responses(page);
    await page.getByRole('button', { name: 'Фильтры', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Фильтры' });
    await dialog.getByLabel('Канал').selectOption('recruiter');
    await dialog.getByLabel('Период').selectOption('all');
    await dialog.getByLabel('Сортировка').selectOption('newest');
    await dialog.getByRole('button', { name: 'Показать', exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'VP Technology, executive search' }),
    ).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Peraton' })).toHaveCount(0);
  });

  test('rows show source-backed status and open the existing response panel', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'B486 mobile response list acceptance');
    await stubB486Session(page);
    await seedB486Workspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openB486Responses(page);

    const response = page
      .getByRole('list', { name: 'Нужно действие' })
      .getByRole('listitem')
      .filter({ hasText: 'Peraton' });
    await expect(response).toContainText('Enterprise Architect, Senior Advisor');
    await expect(response).toContainText('hh.ru');
    await expect(response).toContainText('Пробовали отправить');
    await expect(response.locator('time')).toBeVisible();

    await expect(response).toContainText('Напомнить сегодня');
    await expect(response.locator('svg[data-arrow]')).toHaveCount(0);

    const row = response.getByRole('button', { name: /^Открыть отклик: Peraton/ });
    await expect(row).toHaveCSS('min-height', '44px');
    await row.click();
    const push = page.getByRole('region', { name: 'Процесс' });
    await expect(push).toBeVisible();
    await expect(push.getByRole('heading', { name: /^Peraton,/ })).toBeVisible();
    // Макет 5 `proc`: the panel's groups, each once, from the response's own data.
    for (const group of ['Материалы', 'Доставка']) {
      await expect(push.getByRole('region', { name: group, exact: true })).toHaveCount(1);
    }
    await expect(push.getByRole('status').filter({ hasText: 'Следующий шаг' })).toBeVisible();
    await expect(push.getByRole('region', { name: 'Доставка', exact: true })).toContainText(
      'Не подтверждено',
    );
    await expect(push.getByRole('region', { name: /Peraton/ })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Нужно действие' })).toBeHidden();
    await expect(page.getByRole('tablist', { name: 'Отклики' })).toBeHidden();
    await push.getByRole('button', { name: 'Назад к откликам' }).click();
    await expect(push).toBeHidden();
    await expect(row).toBeFocused();
  });

  test('the 390 page has no desktop panels below the list', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'B486 R19 page bottom');
    await stubB486Session(page);
    await seedB486Workspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openB486Responses(page);
    await expect(page.getByRole('list', { name: 'Нужно действие' })).toBeVisible();
    await expect(page.getByText('Выбранный отклик', { exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Аналитика этапов' })).toBeHidden();
    await expect(page.getByRole('region', { name: 'Закрытые отклики' })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Результативность по каналам' })).toBeHidden();
  });

  test('Выбрать enters selection mode with the manual sending flow under Действия', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'B486 mobile selection mode');
    await stubB486Session(page);
    await seedB486Workspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openB486Responses(page);

    await page.getByRole('button', { name: 'Выбрать', exact: true }).click();
    const toolbar = page.getByRole('toolbar', { name: 'Выбор откликов' });
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole('status')).toHaveText('Выбрано 0');
    const firstRow = page
      .getByRole('list', { name: 'Нужно действие' })
      .getByRole('checkbox')
      .first();
    await firstRow.click();
    await expect(firstRow).toHaveAttribute('aria-checked', 'true');
    await expect(toolbar.getByRole('status')).toHaveText('Выбрано 1');

    await toolbar.getByRole('button', { name: 'Действия' }).click();
    const actions = page.getByRole('region', { name: 'Действия с выбранными' });
    await expect(actions.getByRole('region', { name: 'Ручная отправка' })).toBeVisible();
    await expect(page.getByText(/ничего не уходит без «Отправить»/)).toBeVisible();

    await toolbar.getByRole('button', { name: 'Все', exact: true }).click();
    await expect(toolbar.getByRole('button', { name: 'Все', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await toolbar.getByRole('button', { name: 'Отмена' }).click();
    await expect(toolbar).toBeHidden();
    await expect(page.getByRole('button', { name: 'Выбрать', exact: true })).toBeVisible();
  });

  test('the Этап filter narrows the list to one stage', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'B486 mobile stage filter');
    await stubB486Session(page);
    await seedB486Workspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openB486Responses(page);
    await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Фильтры' });
    await expect(dialog.getByRole('button', { name: 'Сбросить' })).toBeVisible();
    // Макет 5 `stagef`: the «Этап» row opens its own sheet of seven stages with counts.
    await dialog.getByRole('button', { name: /^Этап/ }).click();
    const stageSheet = page.getByRole('dialog', { name: 'Этап' });
    await expect(stageSheet.getByRole('radio')).toHaveCount(7);
    await expect(stageSheet.getByRole('radio', { name: 'Все' })).toBeChecked();
    await stageSheet.getByRole('radio', { name: 'Интервью' }).click();
    await expect(dialog.getByRole('button', { name: /^Этап/ })).toContainText('Интервью');
    await expect(dialog.getByRole('button', { name: /^Этап/ })).toBeFocused();
    await dialog.getByRole('button', { name: 'Показать', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('listitem').filter({ hasText: 'Peraton' })).toHaveCount(0);
  });

  test('automation link uses pending approvals and opens the existing screen', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'B486 mobile automation link acceptance');
    await stubB486Session(page, { pendingApprovalCount: 3 });
    await seedB486Workspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openB486Responses(page);

    const automation = page.getByRole('button', {
      name: 'Автоматизация, 3 ждут одобрения',
    });
    await expect(automation).toBeVisible();
    await automation.click();
    await expect(page.locator('.career-shell')).toHaveAttribute('data-shell-view', 'automation');
  });

  test('tabs show a selected capsule and support keyboard navigation', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'B486 mobile tab acceptance');
    await stubB486Session(page);
    await seedB486Workspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openB486Responses(page);

    const tabs = page.getByRole('tablist', { name: 'Отклики' });
    const funnel = tabs.getByRole('tab', { name: 'Воронка' });
    await expect(tabs.getByRole('tab')).toHaveCount(4);
    for (const key of ['funnel', 'company-wants', 'preparation', 'offers']) {
      const tabId = `career-responses-tab-${key}`;
      const panelId = `career-responses-tab-panel-${key}`;
      await expect(page.locator(`#${tabId}`)).toHaveAttribute('aria-controls', panelId);
      await expect(page.locator(`#${panelId}`)).toHaveAttribute('aria-labelledby', tabId);
    }
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect(funnel).toHaveAttribute('aria-selected', 'true');
    await expect(funnel).toHaveAttribute('tabindex', '0');
    await expect(funnel).toHaveCSS('min-height', '44px');
    const activeFill = await funnel.evaluate(
      (element) => getComputedStyle(element, '::before').backgroundColor,
    );
    expect(activeFill).not.toBe('rgba(0, 0, 0, 0)');

    await funnel.press('ArrowRight');
    const companyWants = tabs.getByRole('tab', { name: 'Хочу' });
    await expect(companyWants).toHaveAttribute('aria-selected', 'true');
    await expect(companyWants).toBeFocused();
    await expect(companyWants).toHaveAttribute(
      'aria-controls',
      'career-responses-tab-panel-company-wants',
    );
    await expect(page.getByRole('tabpanel')).toHaveAttribute(
      'id',
      'career-responses-tab-panel-company-wants',
    );
  });

  test('lower summaries open channel analytics and closed-response reasons', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'B486 mobile summary acceptance');
    await stubB486Session(page);
    await seedB486Workspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openB486Responses(page);

    const channelLink = page.getByRole('button', { name: /Результативность по каналам/ });
    await expect(channelLink).toContainText(/hh\.ru \d+,\d %/);
    await channelLink.click();
    const channels = page.getByRole('region', { name: 'Каналы' });
    await expect(channels).toBeVisible();
    // Макет 5 `learn`: one grouped card per channel plus «Всего» when there are several.
    await expect(
      channels.getByRole('heading', { name: 'Результативность по каналам' }),
    ).toBeVisible();
    const hh = channels.getByRole('region', { name: 'hh.ru' });
    await expect(hh).toContainText('Откликов');
    await expect(hh).toContainText(/Ответили\s*\d+,\d % \(\d+\)/);
    // «Аналитика этапов» stays reachable inside the push.
    await channels.getByRole('button', { name: 'Аналитика этапов' }).click();
    await expect(channels.getByRole('region', { name: 'История этапов откликов' })).toBeVisible();
    await channels.getByRole('button', { name: 'Назад к откликам' }).click();

    const closedLink = page.getByRole('button', { name: /^Закрыто/ });
    await expect(closedLink).toContainText('2');
    await closedLink.click();
    const closed = page.getByRole('region', { name: 'Закрыто' });
    const breakdown = closed.getByRole('region', { name: 'Причины закрытия откликов' });
    await expect(breakdown.getByText('Причина не записана', { exact: true })).toBeVisible();
  });

  test('list grows by 20 rows after its first 10', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'B486 mobile list pagination acceptance');
    const moreApplications = Array.from({ length: 28 }, (_, index) =>
      application({
        id: 'b486-page-' + index,
        stage: 'applied',
        vacancy: {
          title: 'Platform role ' + index,
          company: 'Company ' + index,
          url: 'https://hh.ru/vacancy/' + (100 + index),
          source: 'hh',
        },
        whoseTurn: 'company',
      }),
    );
    await stubB486Session(page, { applications: [...APPLICATIONS, ...moreApplications] });
    await seedB486Workspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openB486Responses(page);

    const actionRows = page.getByRole('list', { name: 'Нужно действие' }).getByRole('listitem');
    const dueRows = page.getByRole('list', { name: 'По сроку шага' }).getByRole('listitem');
    const visibleRowCount = async () => (await actionRows.count()) + (await dueRows.count());
    await expect.poll(visibleRowCount).toBe(10);
    await expect(page.getByText(/^Показано 10 из 35\./)).toBeVisible();

    await page.getByRole('button', { name: 'Показать ещё 20', exact: true }).click();
    await expect.poll(visibleRowCount).toBe(30);
    await expect(page.getByText(/^Показано 30 из 35\./)).toBeVisible();
  });

  test('captures the mobile screenshot for the B486 evidence bundle', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'B486 evidence capture');
    await stubB486Session(page, { pendingApprovalCount: 3, unreadCount: 3 });
    await seedB486Workspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openB486Responses(page);
    await expect(
      page.getByRole('button', { name: 'Автоматизация, 3 ждут одобрения' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Центр уведомлений, 3 непрочитанных' }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    const dir = 'test-results/evidence/B486';
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/app-390.png` });
    await page.screenshot({ path: `${dir}/after-390-home.png`, fullPage: true });
    const back = page.getByRole('button', { name: 'Назад к откликам' });
    await page
      .getByRole('button', { name: /^Открыть отклик:/ })
      .first()
      .click();
    await page.screenshot({ path: `${dir}/after-390-proc.png`, fullPage: true });
    await back.click();
    await page.getByRole('button', { name: /Результативность по каналам/ }).click();
    await page.screenshot({ path: `${dir}/after-390-learn.png`, fullPage: true });
    await back.click();
    await page.getByRole('button', { name: /^Закрыто/ }).click();
    await page.screenshot({ path: `${dir}/after-390-closed.png`, fullPage: true });
    await back.click();
    await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
    await page.screenshot({ path: `${dir}/after-390-filters.png` });
    await page.getByRole('button', { name: /^Этап/ }).click();
    await page.screenshot({ path: `${dir}/after-390-stagef.png` });
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Выбрать', exact: true }).click();
    await page
      .getByRole('toolbar', { name: 'Выбор откликов' })
      .getByRole('button', { name: 'Все', exact: true })
      .click();
    await page.screenshot({ path: `${dir}/after-390-selall.png`, fullPage: true });
  });

  test('does not overflow horizontally at 280 px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'B486 narrow viewport acceptance');
    await page.setViewportSize({ width: 280, height: 844 });
    await stubB486Session(page);
    await seedB486Workspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openB486Responses(page);
    await expect(page.getByRole('button', { name: 'Фильтры', exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Нужно действие' })).toBeVisible();

    const overflow = await page.evaluate(() => {
      const main = document.querySelector('.career-main');
      const mainOverflow = main ? main.scrollWidth - main.clientWidth : 0;
      return Math.max(document.documentElement.scrollWidth - window.innerWidth, mainOverflow);
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
