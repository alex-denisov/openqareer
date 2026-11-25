import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { mockResponses } from './responsesFixture';

const ROWS = '.b640 table.vt tbody tr.vt-row';
const TEXT = 'Ищем руководителя для 3 команд платформы.';

async function mockVacancy(page: Page): Promise<void> {
  await page.route('**/api/v1/candidate/b640/vacancies/*', (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: 'vacancy_not_found', message: 'Вакансия не найдена.' } },
    }),
  );
  await page.route('**/api/v1/candidate/vacancies/*/detail', (route) =>
    route.fulfill({
      json: {
        data: { id: 'v', description: TEXT, truncated: false, skills: [], responsibilities: [] },
      },
    }),
  );
}

async function openList(page: Page): Promise<{ poolReads: () => number }> {
  await mockSignedInCabinet(page, {
    cabinetB640: true,
    vacancyTotal: 45,
    vacancyFacets: {
      total: 45,
      regions: [],
      remote: 0,
      levels: [],
      roles: [{ role: 'Руководитель продукта', count: 12 }],
      sources: [],
    } as never,
  });
  await mockVacancy(page);
  let reads = 0;
  page.on('request', (request) => {
    if (/\/vacancies\/matched\?/u.test(request.url())) reads += 1;
  });
  await page.goto('/app/vacancies', { waitUntil: 'domcontentloaded' });
  await expect(page.locator(ROWS).first()).toBeVisible({ timeout: 15_000 });
  return { poolReads: () => reads };
}

/** Вторая порция, раскрытая строка и место прокрутки. */
async function arrangeList(page: Page) {
  await page.getByRole('button', { name: /Показать ещё/u }).click();
  await expect(page.locator(ROWS)).toHaveCount(40);
  const toggle = page.locator(ROWS).nth(30).locator('.vt-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const apply = page.locator('.vs-acts, .act-dock').getByRole('link', { name: 'Откликнуться' });
  await apply.scrollIntoViewIfNeeded();
  const title = (await toggle.getAttribute('title')) ?? '';
  return { toggle, apply, title, scroll: await page.evaluate(() => window.scrollY) };
}

async function expectSameList(
  page: Page,
  { toggle, scroll }: Awaited<ReturnType<typeof arrangeList>>,
) {
  await expect(page.locator('[data-b640-node="s07"]')).toBeVisible();
  await expect(page.locator(ROWS)).toHaveCount(40);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect
    .poll(() => page.evaluate((at) => Math.abs(window.scrollY - at), scroll))
    .toBeLessThan(3);
}

test.describe('B798: список → объект → назад', () => {
  test('карточка и текст вакансии: назад — тот же список', async ({ page }) => {
    const { poolReads } = await openList(page);
    const list = await arrangeList(page);
    const before = poolReads();
    expect(list.scroll).toBeGreaterThan(300);
    await page.locator('.vs-acts').getByRole('link', { name: 'Открыть полностью' }).click();
    await expect(page.locator('[data-b640-node="v04"]').first()).toBeVisible();
    await expect(page.locator('[data-b640-node="s07"]')).toHaveCount(0);
    const text = page.getByRole('button', { name: /Текст вакансии/u }).first();
    if (await text.isVisible()) {
      await text.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await page.goBack();
    await expectSameList(page, list);
    await page.goForward();
    await expect(page.locator('[data-b640-node="v04"]').first()).toBeVisible();
    await page.getByRole('link', { name: 'Назад к вакансиям' }).locator('visible=true').click();
    await expectSameList(page, list);
    expect(poolReads()).toBe(before);
  });

  test('отклик из «Вакансий»: раздел, путь, текст слева и возврат', async ({ page }, info) => {
    const wide = info.project.name === 'desktop-1440';
    await openList(page);
    const list = await arrangeList(page);
    await list.apply.click();
    await expect(page.locator('[data-b640-node="o02"]').first()).toBeVisible();
    await expect(page.locator('.b640')).toHaveAttribute('data-active', 'vacancies');
    await expect(page.locator('.ctx-title').first()).toContainText(list.title);
    if (wide) {
      const crumbs = page.locator('nav.crumbs');
      await expect(crumbs.getByRole('link').first()).toHaveText('Вакансии');
      await expect(page.locator('.rail a[aria-current="page"]')).toHaveText('Вакансии');
      await expect(page.locator('.vac-col .vac-text')).toContainText(TEXT);
      await page.reload();
      await expect(crumbs.getByRole('link').first()).toHaveText('Вакансии');
      await expect(page.locator('.b640')).toHaveAttribute('data-active', 'vacancies');
      await page.goBack();
      await expect(page.locator(ROWS).first()).toBeVisible();
      return;
    }
    await page.locator('.b640 .topbar').getByRole('link', { name: 'Назад к вакансиям' }).click();
    await expectSameList(page, list);
  });

  test('путь отклика не перестраивается, пока экран читается', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'путь — на 1440');
    await openList(page);
    const { apply } = await arrangeList(page);
    await page.evaluate(() => {
      const seen: string[] = [];
      const note = () => {
        const text = document.querySelector('nav.crumbs')?.textContent?.trim() ?? '';
        if (text && seen.at(-1) !== text) seen.push(text);
      };
      new MutationObserver(note).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      Object.assign(window, { crumbsSeen: seen });
    });
    await apply.click();
    await expect(page.locator('.vac-col .vac-text')).toContainText(TEXT);
    await page.waitForTimeout(800);
    const seen = await page.evaluate(
      () => (window as unknown as { crumbsSeen: string[] }).crumbsSeen,
    );
    expect(seen.filter((text) => !text.startsWith('Вакансии'))).toEqual([]);
    // До куска экрана есть первое звено; название появляется один раз и не меняется.
    expect(new Set(seen.map((text) => text.slice(0, 40))).size).toBeLessThanOrEqual(2);
  });

  test('«Отклики»: фильтр стадий цел после раскрытия и возврата из письма', async ({ page }) => {
    await mockResponses(page);
    await mockVacancy(page);
    await page.goto('/app/responses', { waitUntil: 'domcontentloaded' });
    const chip = page.getByRole('button', { name: /^В работе/u });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    const open = page.locator('[data-b640-node="o01"] [aria-expanded="false"].ot-toggle').first();
    if (await open.count()) {
      await open.click();
      await expect(page.locator('[data-b640-node="o01c"]')).toBeVisible();
      await page.goBack();
    }
    const letter = page.locator('a[href*="/letter"]').locator('visible=true').first();
    await letter.click();
    await expect(page.locator('[data-b640-node="o02"]').first()).toBeVisible();
    await expect(page.locator('.b640')).toHaveAttribute('data-active', 'responses');
    await page.goBack();
    await expect(page.locator('[data-b640-node="o01"]')).toBeVisible();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('B791: «Откликнуться» на 390 (v06b2)', () => {
  test('полоса над навигацией, в строке «Открыть», конец списка не перекрыт', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openList(page);
    await page.locator(`${ROWS} .vt-toggle`).first().click();
    const apply = page.locator('.page > .act-dock.is-auto').getByRole('link');
    await expect(apply).toHaveText('Откликнуться');
    const button = (await apply.boundingBox())!;
    expect([button.x, button.width, button.height]).toEqual([16, 358, 44]);
    const inRow = page.locator('.vs-acts a');
    await expect(inRow).toHaveCount(1);
    await expect(inRow).toHaveAccessibleName('Открыть полностью');
    const more = page.getByRole('button', { name: /Показать ещё/u });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const dock = (await page.locator('.act-dock.is-auto').boundingBox())!;
    const nav = (await page.locator('nav').last().boundingBox())!;
    const last = (await more.boundingBox())!;
    expect(dock.y + dock.height).toBeLessThanOrEqual(nav.y + 1);
    expect(last.y + last.height).toBeLessThanOrEqual(dock.y);
    await page.locator(`${ROWS} .vt-toggle`).first().click();
    await expect(page.locator('.act-dock.is-auto')).toHaveCount(0);
  });
});
