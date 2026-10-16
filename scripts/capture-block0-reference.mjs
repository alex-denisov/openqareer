import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const source = process.env.BLOCK0_MOCKUPS;
if (!source) throw new Error('Set BLOCK0_MOCKUPS to the approved B430-mockups directory.');
const out = path.resolve('output/block-0/reference');
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const measurements = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: 'reduce',
    });
    for (const [name, screen, query] of [
      ['session-loading', '0-vhod-i-pervyj-zapusk', '?frame&view=skeleton'],
      ['source', '0-vhod-i-pervyj-zapusk', '?frame&view=intake'],
      ['goal', '0-vhod-i-pervyj-zapusk', '?frame&view=step1'],
      ['context', '0-vhod-i-pervyj-zapusk', '?frame&view=step3'],
      ['consultant-proposal', '1-segodnya', '?frame&sheet=open'],
    ]) {
      await page.goto(`file://${path.join(source, 'screens', screen + '.html')}${query}`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: path.join(out, `${name}-${width}-original.png`),
        animations: 'disabled',
        fullPage: true,
      });
      // Phone chrome belongs to the OS, not to the browser's content viewport.
      if (width === 390)
        await page.addStyleTag({
          content:
            ':root{--safe-t:0px;--safe-b:0px}html.is-frame body::before,html.is-frame body::after{display:none}',
        });
      await page.screenshot({
        path: path.join(out, `${name}-${width}.png`),
        animations: 'disabled',
        fullPage: true,
      });
      measurements.push({
        name,
        width,
        elements: await page
          .locator(
            '.app:not([hidden]) .topbar,.app:not([hidden]) .panel-col,.app:not([hidden]) .main',
          )
          .evaluateAll((elements) =>
            elements.map((element) => {
              const r = element.getBoundingClientRect();
              return {
                selector: element.className,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
              };
            }),
          ),
      });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(path.join(out, 'geometry.json'), JSON.stringify(measurements, null, 2));
console.log(`Reference captures: ${out}`);
