import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page, Locator } from 'playwright';

interface ScreenshotTile {
  readonly input: Buffer;
  readonly left: number;
  readonly top: number;
}

async function composeTiles(
  page: Page,
  width: number,
  height: number,
  tiles: ScreenshotTile[],
  file: string,
) {
  const background = await page
    .locator('.career-shell')
    .first()
    .evaluate((e) => getComputedStyle(e).getPropertyValue('--career-bg'));
  const compositor = await page.context().browser()!.newPage();
  try {
    const png = await compositor.evaluate(
      async ({ width, height, tiles, background }) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d')!;
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);
        for (const tile of tiles) {
          const bytes = Uint8Array.from(atob(tile.png), (c) => c.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          context.drawImage(bitmap, tile.left, tile.top);
          bitmap.close();
        }
        return canvas.toDataURL('image/png').split(',')[1];
      },
      {
        width,
        height,
        background,
        tiles: tiles.map((tile) => ({
          png: tile.input.toString('base64'),
          left: tile.left,
          top: tile.top,
        })),
      },
    );
    await fs.writeFile(file, Buffer.from(png, 'base64'));
  } finally {
    await compositor.close();
  }
}

interface ScrollFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  total: number;
  top: number;
}
async function collectTiles(page: Page, main: Locator, m: ScrollFrame) {
  const tiles: ScreenshotTile[] = [
    { input: await page.screenshot({ animations: 'disabled' }), left: 0, top: 0 },
  ];
  let previous = 0,
    height = Math.round(m.y + m.h);
  while (previous < m.total - m.h) {
    const actual = await main.evaluate(
      (e, top) => {
        e.scrollTop = top;
        return e.scrollTop;
      },
      Math.min(previous + m.h, m.total - m.h),
    );
    if (actual <= previous) break;
    const delta = actual - previous;
    const input = await page.screenshot({
      animations: 'disabled',
      clip: { x: m.x, y: m.y + m.h - delta, width: m.w, height: delta },
    });
    tiles.push({ input, left: Math.round(m.x), top: height });
    height += Math.round(delta);
    previous = actual;
  }
  return { tiles, height };
}

/** Capture the actual scrolling column at its original width; never expand or restyle it. */
export async function captureScrollableScreen(
  page: Page,
  destination: string,
  name: string,
  width: number,
) {
  if (['city-picker', 'skip-confirm', 'login'].includes(name)) return;
  const main = page.locator('.career-main');
  if (!(await main.count())) return;
  const m = await main.evaluate((e) => ({
    x: e.getBoundingClientRect().x,
    y: e.getBoundingClientRect().y,
    w: e.clientWidth,
    h: e.clientHeight,
    total: e.scrollHeight,
    top: e.scrollTop,
  }));
  if (m.total <= m.h + 1) return;
  await main.evaluate((e) => {
    e.scrollTop = 0;
  });
  const { tiles, height } = await collectTiles(page, main, m);
  await page.screenshot({
    path: path.join(destination, `${name}-bottom-${width}.png`),
    animations: 'disabled',
  });
  await composeTiles(
    page,
    width,
    height,
    tiles,
    path.join(destination, `${name}-full-${width}.png`),
  );
  await main.evaluate((e, top) => {
    e.scrollTop = top;
  }, m.top);
}
