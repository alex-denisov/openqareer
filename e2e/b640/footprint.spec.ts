import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectGates } from './gates';
import { fid, finishSearch, openFootprint, type FootprintCase } from './footprintFixture';

const SHOTS = process.env.B640_SHOTS;
/** Узел адреса без варианта или вариант экрана (f01 до поиска, f04 «ничего рискового»). */
const node = (page: Page, code: string) =>
  page.locator(`[data-b640-node="${code}"]:not([data-b640-state]), [data-b640-state="${code}"]`);
/** В интерфейсе нет способа поиска, названий источников и инструментов. */
const HIDDEN = /sherlock|maigret|hibp|wayback|exa\b|утечк|парол/iu;

test.describe('B652: «Цифровой след»', () => {
  test('до поиска: без галочки согласия кнопка недоступна; согласие и поиск — ожидание на месте', async ({
    page,
  }) => {
    const calls = await openFootprint(page, '/app/profile/footprint', 'fresh');
    const screen = node(page, 'f01');
    await expect(screen.getByText('Ищем по: имя, почта, 2 ссылки')).toBeVisible();
    const go = screen.getByRole('button', { name: 'Начать поиск' });
    await expect(go).toBeDisabled();
    await expectGates(page);

    await screen.getByRole('button', { name: 'Изменить' }).click();
    await screen.getByLabel('Ссылка habr.com/users/msokolova').uncheck();
    await expect(screen.getByText('Ищем по: имя, почта, ссылка')).toBeVisible();
    await screen.getByLabel(/Разрешаю проверить/u).check();
    await go.click();

    await expect(screen.locator('progress.pf-prog')).toBeVisible();
    expect(calls.granted).toEqual(['digital_footprint-v1.1']);
    const sent = calls.started[0] as { selectedQueryIds: string[]; confirmedOwnership: boolean };
    // Ссылка на GitHub ищется в двух местах — одна строка, два запроса.
    expect(sent.selectedQueryIds).toHaveLength(4);
    expect(sent.confirmedOwnership).toBe(true);

    await finishSearch(page);
    await expect(
      node(page, 'p02').getByRole('heading', { name: '6 находок, 4 стоит убрать' }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('сводка P2: категории, находки с уровнем, проверки и согласие; гейты', async ({ page }) => {
    await openFootprint(page, '/app/profile/footprint', 'ready');
    const screen = node(page, 'p02');
    await expect(screen.locator('.fp-cat')).toHaveCount(5);
    await expect(screen.locator('.fp-find')).toHaveCount(6);
    await expect(screen.getByText('Согласие дано 10.11 ·')).toBeVisible();
    await expect(screen.getByRole('link', { name: 'В профиль' })).toHaveCount(0);
    await expect(screen.getByRole('button', { name: 'В профиль' })).toHaveCount(2);
    expect(await screen.innerText()).not.toMatch(HIDDEN);
    await expectGates(page);
  });

  test('«Это не проблема»: отметка уходит на сервер, тост с «Отменить»', async ({ page }) => {
    const calls = await openFootprint(page, '/app/profile/footprint', 'ready');
    const row = node(page, 'p02').locator('.fp-find').first();
    await row.getByRole('button', { name: 'Это не проблема' }).click();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect
      .poll(() => calls.reviews)
      .toEqual([
        { id: fid(1), review: 'hidden' },
        { id: fid(1), review: 'unreviewed' },
      ]);
  });

  test('разбор F3 → находка F3б: письмо, формы поисковиков, путь назад; гейты', async ({
    page,
  }) => {
    await openFootprint(page, '/app/profile/footprint/findings', 'ready');
    const summary = node(page, 'f03');
    await expect(summary.locator('details.fp-acc')).toHaveCount(5);
    await expect(summary.locator('details.fp-acc').first()).toHaveAttribute('open', '');
    await expectGates(page);

    await summary.getByRole('link', { name: 'Закрыть аккаунты' }).first().click();
    const finding = node(page, 'f03b');
    await expect(
      finding.getByRole('heading', { name: 'Почта на двух старых сервисах' }),
    ).toBeVisible();
    await expect(finding.getByText('Находка 1 из 4 · личные данные открыты')).toBeVisible();
    await expect(finding.locator('.fp-letter')).toContainText('Прошу удалить');
    await expect(finding.getByRole('link', { name: /Google/u })).toHaveAttribute(
      'target',
      '_blank',
    );
    await expect(finding.getByRole('link', { name: 'Письмо сайту' })).toHaveAttribute(
      'href',
      /^mailto:\?subject=/u,
    );
    expect(await finding.innerText()).not.toMatch(HIDDEN);
    await expectGates(page);

    await page.getByRole('link', { name: 'Сводка' }).first().click();
    await expect(node(page, 'f03')).toBeVisible();
  });

  test('расхождение с резюме: письмо просит исправить, отметок нет', async ({ page }) => {
    await openFootprint(
      page,
      `/app/profile/footprint/findings/${encodeURIComponent('mismatch:m1')}`,
      'ready',
    );
    const finding = node(page, 'f03b');
    await expect(finding.locator('.fp-letter')).toContainText('«руководитель группы разработки»');
    await expect(finding.getByRole('button', { name: 'Это не я' })).toHaveCount(0);
  });

  test('«Проверить снова» с находки: новый поиск и ход виден в «Цифровом следе»', async ({
    page,
  }) => {
    const calls = await openFootprint(
      page,
      `/app/profile/footprint/findings/${encodeURIComponent('mismatch:m1')}`,
      'ready',
    );
    await node(page, 'f03b').getByRole('button', { name: 'Проверить снова' }).click();
    await expect(node(page, 'f01').locator('progress.pf-prog')).toBeVisible();
    expect(calls.started).toHaveLength(1);
    expect(calls.granted).toEqual([]);
  });

  test('B382 путь удаления: «Письмо отправлено» → «Проверить находку» → «Удалено»; гейты', async ({
    page,
  }) => {
    const calls = await openFootprint(page, `/app/profile/footprint/findings/${fid(1)}`, 'ready');
    const finding = node(page, 'f03b');
    const dock = finding.locator('.fp-dock');
    await dock.getByRole('button', { name: 'Письмо отправлено' }).click();
    await expect(dock.getByText('Письмо отправлено 18.11')).toBeVisible();
    expect(calls.removals).toEqual([fid(1)]);
    await expectGates(page);
    await dock.getByRole('button', { name: 'Проверить находку' }).click();
    await expect(
      finding.getByRole('status').filter({ hasText: 'Удалено · проверено 19.11' }),
    ).toBeVisible();
    expect(calls.rechecks).toEqual([fid(1)]);
    await expectGates(page);
  });

  test('B382: находка ещё на месте — итог проверки у кнопки, проверить можно снова', async ({
    page,
  }) => {
    await openFootprint(page, `/app/profile/footprint/findings/${fid(2)}`, 'ready', 'still_there');
    const dock = node(page, 'f03b').locator('.fp-dock');
    await dock.getByRole('button', { name: 'Письмо отправлено' }).click();
    await dock.getByRole('button', { name: 'Проверить находку' }).click();
    await expect(dock.getByText('Ещё на месте · проверено 19.11')).toBeVisible();
    await expect(dock.getByRole('button', { name: 'Проверить находку' })).toBeEnabled();
    await expect(page.getByText(/Удалено · проверено/u)).toHaveCount(0);
  });

  test('F4: рискового нет — честная строка и «Искать со ссылками»', async ({ page }) => {
    await openFootprint(page, '/app/profile/footprint/findings', 'nothing');
    const screen = node(page, 'f04');
    await expect(screen.getByRole('status')).toHaveText('Рискового не нашли: 4 категории');
    await screen.getByRole('link', { name: 'Искать со ссылками' }).click();
    await expect(node(page, 'f01')).toBeVisible();
  });

  test('сбой поиска: строка ошибки с «Повторить» на месте', async ({ page }) => {
    const calls = await openFootprint(page, '/app/profile/footprint', 'failed');
    const screen = node(page, 'f01');
    await expect(screen.getByRole('alert')).toContainText('Проверили не всё');
    await screen.getByRole('button', { name: 'Повторить' }).click();
    await expect(screen.locator('progress.pf-prog')).toBeVisible();
    expect(calls.started).toHaveLength(1);
  });

  test('отзыв согласия: подтверждение на месте, затем экран до поиска', async ({ page }) => {
    const calls = await openFootprint(page, '/app/profile/footprint', 'ready');
    const screen = node(page, 'p02');
    await screen.locator('.revoke summary').click();
    await screen.getByRole('button', { name: 'Оставить' }).click();
    expect(calls.revoked).toBe(0);
    await screen.locator('.revoke summary').click();
    await screen
      .getByRole('group', { name: 'Отозвать согласие?' })
      .getByRole('button', { name: 'Отозвать' })
      .click();
    await expect(node(page, 'f01').getByRole('button', { name: 'Начать поиск' })).toBeDisabled();
    expect(calls.revoked).toBe(1);
  });

  const SCREENS: ReadonlyArray<readonly [string, string, FootprintCase]> = [
    ['p02-profil-cifrovoj-sled', '/app/profile/footprint', 'ready'],
    ['f01-cifrovoj-sled-do-poiska', '/app/profile/footprint', 'fresh'],
    ['f03-razbor-po-odnoj', '/app/profile/footprint/findings', 'ready'],
    ['f03b-nahodka-put-udaleniya', `/app/profile/footprint/findings/${fid(1)}`, 'ready'],
    ['f04-nichego-ne-nashli', '/app/profile/footprint/findings', 'nothing'],
  ];

  for (const [name, path, kind] of SCREENS) {
    test(`снимки: ${name}`, async ({ page }, testInfo) => {
      test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
      mkdirSync('.s13-shots', { recursive: true });
      const desktop = testInfo.project.name === 'desktop-1440';
      const widths = desktop ? [1440, 1176] : [390];
      await openFootprint(page, path, kind);
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('.b640 [data-b640-node]')).toBeVisible();
        for (const width of widths) {
          await page.setViewportSize({ width, height: desktop ? 900 : 844 });
          await page.screenshot({
            path: `.s13-shots/${name}-${width}-${theme}.png`,
            fullPage: true,
          });
        }
      }
    });
  }
});
