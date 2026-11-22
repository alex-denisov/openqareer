import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';

/**
 * n06 (B645, 22.11): в .app (системный WebKit) «Язык» и «Часовой пояс» рисовались
 * нативным меню macOS — 24 px вместо 44 и скругление 6 вместо 12; «Обновления»
 * и «Скачать» из-за этого поднимались на 10 px.
 */
test.use({ browserName: 'webkit', viewport: { width: 1440, height: 900 } });

test('n06 selects keep the control shape in WebKit', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1440', 'one viewport is enough for the engine check');
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.goto('/app/account/app', { waitUntil: 'domcontentloaded' });
  const selects = page.locator('[data-b640-node="n06"] .sec-sel');
  await expect(selects).toHaveCount(2, { timeout: 15_000 });
  for (const select of await selects.all()) {
    const shape = await select.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        radius: parseFloat(style.borderTopLeftRadius),
        appearance: style.appearance,
        arrowRoom: parseFloat(style.paddingRight) - parseFloat(style.paddingLeft),
      };
    });
    expect(shape.appearance).toBe('none');
    expect(shape.height).toBeGreaterThanOrEqual(44);
    expect(shape.radius).toBeGreaterThanOrEqual(12);
    expect(shape.arrowRoom).toBeGreaterThan(0);
  }
});
