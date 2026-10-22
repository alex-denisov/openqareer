import { expect, test, type Page } from '@playwright/test';

import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { matchedVacancyPage } from './fixtures/readabilityWorkspace';

// B446-r (R6): окно .app уменьшают сознательно — «Применить» поповеров
// «Локации» и «Источники» видна и нажимается при любой высоте окна.
test.use({ browserName: 'webkit' });

const SIZES = [
  { width: 900, height: 700 },
  { width: 1024, height: 700 },
  { width: 1280, height: 800 },
] as const;

const CITIES = ['Москва', 'Тверь', 'Тула', 'Воронеж', 'Казань', 'Самара', 'Пермь', 'Омск'];

async function mockPool(page: Page): Promise<void> {
  await mockSignedInCabinet(page, { vacancyTotal: 400 });
  const base = matchedVacancyPage(0, 5);
  const facets = {
    total: 400,
    regions: [],
    remote: 20,
    levels: [],
    roles: [],
    sources: Array.from({ length: 30 }, (_, index) => ({
      sourceId: `source-${index}`,
      name: `Источник ${index + 1}`,
      count: 30 - index,
      groupId: 'aggregators',
    })),
    places: [
      ...CITIES.map((location, index) => ({ location, region: 'ru', count: 10 + index })),
      { location: 'Austin, TX', country: 'United States', region: 'us', count: 200 },
      { isRemote: true, count: 20 },
    ],
  };
  await page.route('**/api/v1/candidate/matched-vacancies**', (route) =>
    route.fulfill({ json: { ...base, meta: { ...base.meta, total: 400, facets } } }),
  );
}

async function applyIsReachable(page: Page): Promise<void> {
  const apply = page
    .locator('#vacancies-filter-popover')
    .getByRole('button', { name: 'Применить' });
  await expect(apply).toBeVisible();
  const box = (await apply.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  const hit = await apply.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const target = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return Boolean(target && button.contains(target));
  });
  expect(hit).toBe(true);
}

for (const size of SIZES) {
  test(`B446-r: «Применить» видна в «Локациях» и «Источниках» на ${size.width}×${size.height}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'размеры окна задаёт сам тест');
    await page.setViewportSize(size);
    await mockPool(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Вакансии', exact: true }).click();
    await expect(page.locator('.vac-list-item').first()).toBeVisible({ timeout: 15_000 });
    for (const group of ['locations', 'sources']) {
      await page.locator(`[data-filter-group="${group}"]`).click();
      await applyIsReachable(page);
      await page
        .locator('#vacancies-filter-popover')
        .getByRole('button', { name: 'Отмена' })
        .click();
    }
  });
}
