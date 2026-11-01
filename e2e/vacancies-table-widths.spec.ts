import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const EVIDENCE = process.env.VACANCY_WIDTHS_EVIDENCE_DIR ?? 'output/playwright/vacancy-widths';

async function openVacancies(page: Page): Promise<void> {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const navigation = page.getByRole('button', { name: 'Вакансии', exact: true });
  await expect(navigation).toBeVisible({ timeout: 15_000 });
  await navigation.click();
  await expect(page.locator('.vac-list-item').first()).toBeVisible({ timeout: 15_000 });
}

/** Cells of one row that overlap horizontally, and words split across lines inside a cell. */
async function layoutDefects(page: Page): Promise<string[]> {
  return page.locator('.vacancies-screen-row-trigger').evaluateAll((rows) => {
    const defects: string[] = [];
    rows.slice(0, 12).forEach((row, index) => {
      const cells = [...row.children]
        .map((cell) => cell.getBoundingClientRect())
        .filter((box) => box.width > 0);
      for (let left = 0; left < cells.length - 1; left += 1) {
        if (cells[left]!.right > cells[left + 1]!.left + 1)
          defects.push(`row ${index}: cell ${left} overlaps ${left + 1}`);
      }
      for (const cell of [...row.children]) {
        const edge = cell.getBoundingClientRect().right;
        for (const inner of cell.querySelectorAll('*')) {
          const box = inner.getBoundingClientRect();
          if (box.width > 0 && box.right > edge + 1) {
            defects.push(`row ${index}: «${inner.textContent?.trim()}» spills out of its cell`);
          }
        }
      }
      for (const cell of row.querySelectorAll<HTMLElement>('*')) {
        if (cell.children.length === 0 && cell.scrollWidth > cell.clientWidth + 1) {
          defects.push(`row ${index}: «${cell.textContent?.trim()}» overflows`);
        }
      }
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        for (const match of text.matchAll(/\p{L}{4,}/gu)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          if (range.getClientRects().length > 1) defects.push(`row ${index}: «${match[0]}» breaks`);
        }
      }
    });
    return defects;
  });
}

for (const width of [1440, 1176, 900]) {
  test(`vacancy table holds at ${width} px (01.11 .app acceptance)`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-390', 'desktop widths only');
    await mockSignedInCabinet(page);
    await page.setViewportSize({ width, height: 900 });
    await openVacancies(page);
    mkdirSync(EVIDENCE, { recursive: true });
    await page.screenshot({ path: `${EVIDENCE}/vacancies-${width}.png`, animations: 'disabled' });
    expect(await layoutDefects(page)).toEqual([]);
  });
}

test('vacancy list at 390 px (01.11 .app acceptance)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'mobile only');
  await mockSignedInCabinet(page);
  await openVacancies(page);
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: `${EVIDENCE}/vacancies-390.png`, animations: 'disabled' });
});

/** The button's centre hits the button itself, not the consultant dock above it. */
async function buttonIsHittable(page: Page): Promise<string> {
  return page.getByRole('button', { name: 'Показать ещё 20' }).evaluate((button) => {
    // Scroll and hit-test in one task, before the auto-load moves the footer away.
    button.scrollIntoView({ block: 'end' });
    const box = button.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (hit !== null && button.contains(hit)) return 'button';
    return `covered by ${hit?.className ?? 'nothing'} at ${Math.round(box.top)}-${Math.round(box.bottom)} of ${innerHeight}`;
  });
}

test('the list end loads more rows on scroll and the button stays clickable', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-390', 'desktop list');
  await mockSignedInCabinet(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await openVacancies(page);
  const rows = page.locator('.vac-list-item');
  await expect(rows).toHaveCount(20);
  const more = page.getByRole('button', { name: 'Показать ещё 20' });
  await more.scrollIntoViewIfNeeded();
  await expect.poll(() => rows.count()).toBeGreaterThan(20);
  expect(await buttonIsHittable(page)).toBe('button');
});
