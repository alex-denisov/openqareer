/**
 * Rasterises `public/favicon.svg` into the icon files the document references.
 *
 * The icons used to be hand-produced, and the vector source drifted away from
 * them: the magnifier handle's round cap ended at y=65.6 inside a 64-unit
 * viewBox, so every rendered size shipped with the handle sliced off at the
 * bottom-right corner (B168). Generating them from the one source keeps the
 * mark and its raster copies from disagreeing again.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PUBLIC_DIRECTORY = 'public';
/** Sizes packed into `favicon.ico`, smallest first, as the format expects. */
const ICO_SIZES = [16, 32, 48];
const PNG_SIZES = [16, 32, 64];
/** Apple refuses transparency and composites on black; paint the ground. */
const APPLE_BACKGROUND = '#090d12';
const APPLE_SIZE = 180;
/**
 * iOS masks the icon with a rounded superellipse, so the corners are cropped.
 * The mark reaches its own bounding box in the bottom-right, which is exactly
 * where that crop bites, so it is inset rather than drawn edge to edge.
 */
const APPLE_MARK_SCALE = 0.7;

async function renderPng(page, svg, size, options = {}) {
  const { background, markScale = 1 } = options;
  const mark = Math.round(size * markScale);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>html,body{margin:0;padding:0;width:${size}px;height:${size}px;
     background:${background ?? 'transparent'};
     display:flex;align-items:center;justify-content:center}
     svg{display:block;width:${mark}px;height:${mark}px}</style>${svg}`,
  );
  return page.screenshot({ omitBackground: !background, type: 'png' });
}

/**
 * An ICO file is a six-byte header, one sixteen-byte directory entry per
 * image, then the images themselves. PNG payloads are stored verbatim, which
 * every browser in support has read since IE 11.
 */
export function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const directory = [];
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    directory.push(entry);
    offset += image.data.length;
  }

  return Buffer.concat([header, ...directory, ...images.map((image) => image.data)]);
}

async function main() {
  const svg = readFileSync(join(PUBLIC_DIRECTORY, 'favicon.svg'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  try {
    for (const size of PNG_SIZES) {
      const data = await renderPng(page, svg, size);
      writeFileSync(join(PUBLIC_DIRECTORY, `favicon-${size}x${size}.png`), data);
    }
    const icoImages = [];
    for (const size of ICO_SIZES) {
      icoImages.push({ size, data: await renderPng(page, svg, size) });
    }
    writeFileSync(join(PUBLIC_DIRECTORY, 'favicon.ico'), packIco(icoImages));

    const apple = await renderPng(page, svg, APPLE_SIZE, {
      background: APPLE_BACKGROUND,
      markScale: APPLE_MARK_SCALE,
    });
    writeFileSync(join(PUBLIC_DIRECTORY, 'apple-touch-icon.png'), apple);
  } finally {
    await page.close();
    await browser.close();
  }
  process.stdout.write(
    `favicons png=${PNG_SIZES.join(',')} ico=${ICO_SIZES.join(',')} apple=${APPLE_SIZE}\n`,
  );
}

await main();
