import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const source = process.env.BLOCK0_MOCKUPS;
if (!source) throw new Error('Set BLOCK0_MOCKUPS to the approved B430-mockups directory.');
const root = path.resolve('output/block-0');
const cases = [
  {
    name: 'source-style',
    file: 'source',
    view: 'intake',
    width: 1440,
    keys: ['color', 'backgroundColor', 'borderColor'],
    pairs: [
      ['.source-opt:not(.is-picked)', '.first-run-source-opt:not(.is-picked)'],
      [
        '.source-opt.is-picked .source-ico',
        '.first-run-source-opt.is-picked .first-run-source-ico',
      ],
    ],
  },
  {
    name: 'city-style',
    file: 'city-picker-selected',
    view: 'city',
    width: 390,
    keys: [
      'fontSize',
      'fontWeight',
      'lineHeight',
      'color',
      'fontFamily',
      'fontSmoothing',
      'textRendering',
    ],
    pairs: [
      ['.m-city b', '.first-run-city-name'],
      ['.m-city i', '.first-run-city-detail'],
    ],
  },
  {
    name: 'source-mobile',
    file: 'source',
    view: 'intake',
    width: 390,
    pairs: [['.stage.is-here .stage-head button svg', '.first-run-source-help svg']],
  },

  {
    name: 'source',
    file: 'source',
    view: 'intake',
    width: 1440,
    pairs: [
      ['.stage.is-here .stage-head button svg', '.first-run-source-help svg'],
      ['.stage.is-pending .stage-no', '.first-run-pending-context .first-run-stage-badge'],
      ['.stage.is-pending .tag', '.first-run-pending-context small'],
      ['.stage.is-pending', '.first-run-pending-context'],
      ['.stage.is-done button', '.first-run-stage-card.is-done button'],
      ['.stage.is-done button svg', '.first-run-edit-icon'],
      ['.career-expert-name', '.career-expert-identity strong'],
      ['.career-expert-scope', '.career-expert-identity small'],
      ['.career-expert-avatar svg', '.career-expert-identity > span svg'],
      ['.career-expert-thread', '.career-expert-conversation'],
      ['.career-expert-turn p', '.career-dialogue-turn.is-assistant p'],
      ['.career-expert-starters', '.career-expert-starters'],
      ['.career-expert-starters button', '.career-expert-starters button'],
      ['.career-expert-composer', '.career-expert-composer'],
    ],
  },
  {
    name: 'goal',
    file: 'goal',
    view: 'step1',
    width: 390,
    pairs: [
      ['.m-steps', '.first-run-steps-bar'],
      ['.stage-head', '.first-run-stage-card.is-active .first-run-stage-head'],
      ['.m-lead', '.first-run-goal-lead'],
      ['.m-group', '.first-run-goal-input'],
      ['.career-textarea', '.first-run-textarea'],
      ['.m-next', '.first-run-btn-save-goal'],
    ],
  },
  {
    name: 'context',
    file: 'context-filled',
    view: 'step3',
    width: 390,
    pairs: [
      ['.stage-head', '.first-run-stage-card.is-active .first-run-stage-head'],
      ['.m-lead', '.first-run-context-description'],
      ['.m-group', '.first-run-context-fields'],
      ['.m-pick', '.first-run-pick-btn'],
      ['.career-select-wrap', '.first-run-format-control'],
      ['.career-select', '.first-run-select'],
      ['.m-switch', '.first-run-relocation-label'],
      ['.m-switch > i', '.first-run-relocation-label input'],
    ],
  },
  {
    name: 'city',
    file: 'city-picker-selected',
    view: 'city',
    width: 390,
    pairs: [
      ['.m-sheet', '.first-run-city-panel'],
      ['.m-sheet-head', '.first-run-city-header'],
      ['.m-sheet-head h2', '.first-run-city-title'],
      ['.m-sheet-done', '.first-run-city-header button'],
      ['.m-search', '.first-run-city-search-wrap'],
      ['.m-sheet-sec', '.first-run-city-section-label'],
      ['.m-cities', '.first-run-city-list'],
      ['.m-city', '.first-run-city-item'],
    ],
  },
  {
    name: 'today',
    file: 'consultant-open',
    width: 1440,
    pairs: [
      ['.section-head .tag', '.career-today-queue-count'],
      ['.q2-item', '.career-today-queue-desktop-row'],
      ['.q2-main a', '.career-today-queue-desktop-copy strong'],
      ['.q2-due .tag', '.career-today-queue-desktop-deadline > span'],
      ['.fn-step', '.career-today-funnel-list > li'],
      ['.fn-step .num', '.career-today-funnel-value'],
      ['.fn-step > span:nth-child(2)', '.career-today-funnel-label'],
      ['.fn-step .meter-bar', '.career-today-funnel-track'],
    ],
  },
];

async function measure(page, selectors) {
  return page.evaluate(
    (selectors) =>
      selectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        const box = element.getBoundingClientRect(),
          css = getComputedStyle(element);
        return {
          selector,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          fontSize: css.fontSize,
          fontWeight: css.fontWeight,
          color: css.color,
          backgroundColor: css.backgroundColor,
          borderColor: css.borderColor,
          lineHeight: css.lineHeight,
          borderRadius: css.borderRadius,
          padding: css.padding,
          fontFamily: css.fontFamily,
          fontSmoothing: css.webkitFontSmoothing,
          textRendering: css.textRendering,
        };
      }),
    selectors,
  );
}

const browser = await chromium.launch();
const measurements = [],
  differences = [];
try {
  for (const item of cases) {
    const page = await browser.newPage({
      viewport: { width: item.width, height: item.width === 390 ? 844 : 900 },
      reducedMotion: 'reduce',
    });
    await page.route('**/*', (route) =>
      route.request().isNavigationRequest() && route.request().frame() !== page.mainFrame()
        ? route.abort()
        : route.continue(),
    );
    const screen = item.view ? '0-vhod-i-pervyj-zapusk' : '1-segodnya';
    await page.goto(
      `file://${path.join(source, 'screens', screen + '.html')}?frame${item.view ? '&view=' + item.view : ''}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.evaluate(() => document.fonts.ready);
    if (item.width === 390)
      await page.addStyleTag({
        content:
          ':root{--safe-t:0px;--safe-b:0px}html.is-frame body::before,html.is-frame body::after{display:none}',
      });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const prefix = item.view ? `.app[data-view="${item.view}"] ` : '';
    const reference = await measure(
      page,
      item.pairs.map((pair) => prefix + pair[0]),
    );
    await page.goto(
      `file://${path.join(root, 'after-complete', `${item.file}-${item.width}.html`)}`,
      { waitUntil: 'domcontentloaded' },
    );
    const actual = await measure(
      page,
      item.pairs.map((pair) => pair[1]),
    );
    compareCase(item, reference, actual, measurements, differences);
    await page.close();
  }
} finally {
  await browser.close();
}
await fs.writeFile(
  path.join(root, 'approved-measurements.json'),
  JSON.stringify({ measurements, differences }, null, 2),
);
console.log(`Approved element checks: ${measurements.length}; differences: ${differences.length}`);
for (const difference of differences) console.log(JSON.stringify(difference));
if (differences.length) process.exitCode = 1;

function compareCase(item, reference, actual, measurements, differences) {
  for (let i = 0; i < reference.length; i += 1) {
    // Today has candidate-owned content: compare row/card geometry and typography, not absolute Y.
    // Text widths vary with actual company names and are not evidence of a layout defect.
    const keys =
      item.keys ??
      (item.name === 'today'
        ? [
            'height',
            'fontSize',
            'fontWeight',
            'lineHeight',
            'borderRadius',
            'padding',
            'fontFamily',
          ]
        : ['x', 'y', 'width', 'height', 'fontSize', 'fontWeight', 'lineHeight']);
    for (const key of keys) {
      const expected = reference[i][key],
        got = actual[i][key];
      const equal = typeof expected === 'number' ? Math.abs(expected - got) <= 1 : expected === got;
      const entry = { screen: item.name, element: actual[i].selector, key, expected, actual: got };
      measurements.push(entry);
      if (!equal) differences.push(entry);
    }
  }
}
