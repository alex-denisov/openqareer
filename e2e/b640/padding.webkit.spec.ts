import { expect, test, type Locator } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';

/**
 * The .app window (system WebKit of macOS 26) dropped `padding-inline: var(...)`
 * and other logical shorthands with var() under the B640 barrier
 * `all: revert-layer`: tabs stuck together, filter text touched its border.
 * The build rewrites them to physical sides (scripts/vite/logicalVarToPhysical.ts).
 */
test.use({ browserName: 'webkit', viewport: { width: 1440, height: 900 } });

const LOGICAL_VAR_SHORTHAND =
  /(?:^|[\s;{])(?:(?:padding|margin|scroll-padding|scroll-margin|inset)-(?:inline|block)|border-(?:inline|block)(?:-(?:start|end|width|style|color))?)\s*:[^;}]*var\(/u;

async function box(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const range = document.createRange();
    range.selectNodeContents(element);
    return {
      left: parseFloat(style.paddingLeft),
      right: parseFloat(style.paddingRight),
      width: element.getBoundingClientRect().width,
      text: range.getBoundingClientRect().width,
    };
  });
}

test('B640 tabs and filters keep their inline padding in WebKit', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1440', 'one viewport is enough for the engine check');
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
  await page.goto('/app/vacancies', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node]').first()).toBeVisible({ timeout: 15_000 });

  const tab = await box(page.locator('.b640 .sec-tabs a').first());
  expect(tab.left).toBe(12);
  expect(tab.right).toBe(12);
  expect(tab.width).toBeGreaterThanOrEqual(tab.text + 24);

  const filter = page.locator('.b640 button', { hasText: 'Все роли' }).first();
  await expect(filter).toBeVisible();
  const filterBox = await box(filter);
  expect(filterBox.left).toBeGreaterThan(0);
  expect(filterBox.right).toBeGreaterThan(0);

  const leftovers = await page.evaluate((source) => {
    const pattern = new RegExp(source, 'u');
    const found: string[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText.includes('.b640')) {
          if (pattern.test(rule.style.cssText)) found.push(rule.cssText.slice(0, 120));
        }
        if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);
    return found;
  }, LOGICAL_VAR_SHORTHAND.source);
  expect(leftovers).toEqual([]);
});
