import type { Page } from '@playwright/test';

/**
 * B553: e2e не ходит в сеть за подложкой карты. Хост тайлов OpenFreeMap отвечает
 * пустыми тайлами (карта грузится, капсулы на месте) или обрывом (`fail`), чтобы
 * проверить состояние «Карта недоступна».
 */
export async function mockMapTiles(page: Page, mode: 'empty' | 'fail' = 'empty'): Promise<void> {
  await page.route('https://tiles.openfreemap.org/**', async (route) => {
    if (mode === 'fail') return route.abort('internetdisconnected');
    const url = new URL(route.request().url());
    if (url.pathname === '/planet') {
      return route.fulfill({
        json: {
          tilejson: '3.0.0',
          tiles: ['https://tiles.openfreemap.org/planet/e2e/{z}/{x}/{y}.pbf'],
          minzoom: 0,
          maxzoom: 14,
        },
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/x-protobuf',
      body: Buffer.alloc(0),
    });
  });
}
