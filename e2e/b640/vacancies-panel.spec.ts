import { expect, test, type Page } from '@playwright/test';
import { matchedVacancyPage } from '../fixtures/readabilityWorkspace';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';

const LONG_ROLE = 'Vice President of Engineering';
const ROLE_CELL = '.b640 table.vt tbody tr.vt-row .vt-role';
const ROLE_TEXT = '.b640 table.vt tbody tr.vt-row .vt-toggle span';
/** Запас на округление и полосу прокрутки между окнами. */
const TOLERANCE = 8;
const READABLE_CHARS = 20;

async function openList(page: Page): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  // Мок подборки ставим после общей заглушки: иначе она перекрывает его.
  const source = matchedVacancyPage(0, 3);
  const data = source.data.map((item) => ({
    ...item,
    cluster: { ...item.cluster, canonicalTitle: LONG_ROLE },
  }));
  await page.route('**/api/v1/candidate/matched-vacancies**', (route) =>
    route.fulfill({ json: { ...source, data } }),
  );
  await page.goto('/app/vacancies', { waitUntil: 'domcontentloaded' });
  await expect(page.locator(ROLE_CELL).first()).toBeVisible({ timeout: 15_000 });
}

async function roleWidth(page: Page): Promise<number> {
  const box = await page.locator(ROLE_CELL).first().boundingBox();
  return box?.width ?? 0;
}

test.describe('B640: «Вакансии» при открытой панели консультанта', () => {
  test('роль не сжимается: ширина не меньше, чем на 1176 без панели, текст читается', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-390', 'только настольные окна');
    await page.setViewportSize({ width: 1176, height: 900 });
    await openList(page);
    const reference = await roleWidth(page);
    expect(reference).toBeGreaterThan(0);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.b640 .btn-panel').click();
    await expect(page.locator('.b640 .app.has-panel')).toBeVisible();
    await expect(page.locator(ROLE_CELL).first()).toBeVisible();

    expect(await roleWidth(page)).toBeGreaterThanOrEqual(reference - TOLERANCE);
    const text = page.locator(ROLE_TEXT).first();
    const { scrollWidth, clientWidth } = await text.evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }));
    // Не обрезано раньше 20 знаков: либо влезло целиком, либо видно не меньше 20 знаков.
    const visibleChars = Math.floor((clientWidth / scrollWidth) * LONG_ROLE.length);
    expect(scrollWidth <= clientWidth || visibleChars >= READABLE_CHARS).toBe(true);
  });
});
