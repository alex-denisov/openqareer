import { expect, test, type Page } from '@playwright/test';

/**
 * B593: первый кадр до бандла. Главный скрипт держится, пока идёт замер, — на экране
 * то, что видно в первые сотни миллисекунд: цвет страницы и полосы браузера.
 */
const LIGHT_BG = 'rgb(246, 250, 250)';
const DARK_BG = 'rgb(6, 14, 14)';
const LEGACY_BG = 'rgb(7, 11, 17)';

async function firstFrame(page: Page, storage: Record<string, string>, path = '/app/profile') {
  await page.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
  }, storage);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/index-[^/]+\.js$/u, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(path, { waitUntil: 'commit' });
  // Первый кадр — когда основная таблица стилей уже применена, а бандл ещё держится.
  await page.waitForFunction(
    () =>
      document.body !== null &&
      getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)',
  );
  const frame = await page.evaluate(() => ({
    background: (() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.fillStyle = getComputedStyle(document.body).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
      return `rgb(${red}, ${green}, ${blue})`;
    })(),
    bar: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    mounted: document.querySelector('#root > :not([data-bootstrap-shell])') !== null,
    prerendered: (() => {
      const shell = document.querySelector<HTMLElement>('[data-bootstrap-shell]');
      return shell !== null && shell.getClientRects().length > 0;
    })(),
  }));
  release();
  return frame;
}

test.describe('B593: тема с первого кадра', () => {
  test('новый кабинет, светлая — светлая страница и полоса до бандла', async ({ page }) => {
    const frame = await firstFrame(page, { oq_b640_theme: 'light', oq_cabinet_b640: '1' });
    expect(frame).toEqual({
      background: LIGHT_BG,
      bar: '#f6fafa',
      mounted: false,
      prerendered: false,
    });
  });

  test('новый кабинет, тёмная — тёмная страница его цвета', async ({ page }) => {
    const frame = await firstFrame(page, { oq_b640_theme: 'dark', oq_cabinet_b640: '1' });
    expect(frame).toEqual({
      background: DARK_BG,
      bar: '#060e0e',
      mounted: false,
      prerendered: false,
    });
  });

  test('«Как в системе» при тёмной ОС — тёмная, при светлой — светлая', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await firstFrame(page, { oq_b640_theme: 'system' })).toMatchObject({
      background: DARK_BG,
    });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    expect(await firstFrame(page, { oq_b640_theme: 'system' })).toMatchObject({
      background: LIGHT_BG,
    });
  });

  test('новый кабинет без выбранной темы — светлая, как его тема по умолчанию', async ({
    page,
  }) => {
    const frame = await firstFrame(page, { oq_cabinet_b640: '1' });
    expect(frame).toMatchObject({ background: LIGHT_BG, bar: '#f6fafa', prerendered: false });
  });

  test('без признаков нового кабинета — как раньше, тёмная', async ({ page }) => {
    const frame = await firstFrame(page, {});
    expect(frame).toMatchObject({ background: LEGACY_BG, bar: '#090d12', mounted: false });
  });

  test('лендинг у пользователя нового кабинета не меняется', async ({ page }) => {
    const frame = await firstFrame(page, { oq_b640_theme: 'light', oq_cabinet_b640: '1' }, '/');
    expect(frame).toMatchObject({ background: LEGACY_BG, bar: '#090d12', mounted: false });
  });
});
