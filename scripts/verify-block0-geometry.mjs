import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const mockups = process.env.BLOCK0_MOCKUPS;
if (!mockups) throw new Error('Set BLOCK0_MOCKUPS to the approved B430-mockups directory.');
const out = path.resolve('output/block-0');
const cases = [
  {
    name: 'source',
    query: '?frame&view=intake',
    folder: 'S11-WIZ-2',
    file: 'step-2-source',
    groups: [
      ['source rows', '.source-opt', '.first-run-source-opt'],
      ['source icons', '.source-ico', '.first-run-source-ico'],
      ['source glyphs', '.source-ico svg', '.first-run-source-ico svg'],
      ['source actions', '.source-opt button', '.first-run-source-action-label'],
    ],
  },
  {
    name: 'session-loading',
    query: '?frame&view=skeleton',
    folder: 'BLOCK-0',
    file: 'session-loading',
    groups: [
      ['skeleton cards', '.today section', '.career-today-skeleton-card'],
      [
        'skeleton bars',
        '.today .skel',
        '.career-today-skeleton-line,.career-today-skeleton-title,.career-today-skeleton-actions span,.career-today-skeleton-queue-row>span',
      ],
    ],
  },
];
async function measure(browser, url, width, selector, reference) {
  const page = await browser.newPage({
    viewport: { width, height: width === 390 ? 844 : 900 },
    reducedMotion: 'reduce',
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.fonts.ready);
    if (reference && width === 390)
      await page.addStyleTag({
        content:
          ':root{--safe-t:0px;--safe-b:0px}html.is-frame body::before,html.is-frame body::after{display:none}',
      });
    const target = reference
      ? selector
          .split(',')
          .map((part) => `.app:not([hidden]) ${part}`)
          .join(',')
      : selector;
    return await page.locator(target).evaluateAll((elements) =>
      elements
        .filter((element) => element.getClientRects().length)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }),
    );
  } finally {
    await page.close();
  }
}
function compare(reference, actual) {
  const differences = [];
  if (reference.length !== actual.length)
    differences.push({
      reason: 'element_count',
      reference: reference.length,
      actual: actual.length,
    });
  for (let index = 0; index < Math.min(reference.length, actual.length); index += 1)
    for (const key of ['x', 'y', 'width', 'height']) {
      const delta = actual[index][key] - reference[index][key];
      if (Math.abs(delta) > 1)
        differences.push({
          index,
          key,
          reference: reference[index][key],
          actual: actual[index][key],
          delta,
        });
    }
  return differences;
}

const browser = await chromium.launch();
const results = [];
let checked = 0;
try {
  for (const width of [1440, 390])
    for (const item of cases)
      for (const [group, referenceSelector, actualSelector] of item.groups) {
        const reference = await measure(
          browser,
          `file://${path.join(mockups, 'screens/0-vhod-i-pervyj-zapusk.html')}${item.query}`,
          width,
          referenceSelector,
          true,
        );
        const actual = await measure(
          browser,
          `file://${path.resolve(out, 'after-complete', `${item.name}-${width}.html`)}`,
          width,
          actualSelector,
          false,
        );
        const differences = compare(reference, actual);
        checked += Math.min(reference.length, actual.length) * 4;
        results.push({
          name: item.name,
          width,
          group,
          elements: reference.length,
          reference,
          actual,
          differences,
        });
      }
} finally {
  await browser.close();
}
const failures = results.flatMap((result) => result.differences);
await fs.writeFile(
  path.join(out, 'geometry.json'),
  JSON.stringify({ tolerancePx: 1, checked, failures: failures.length, results }, null, 2),
);
console.log(`Block 0 geometry: ${checked} measurements, ${failures.length} differences over 1px.`);
if (failures.length) process.exitCode = 1;
