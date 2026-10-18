import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../e2e/fixtures/mockSignedInCabinet';
import { installBlockAVisualFixture } from './fixtures/block-a-visual-fixture';
import { captureCareerHarness } from '../e2e/helpers/capture-career-harness';
import { captureScrollableScreen } from './block-a-screenshot';
import { seedBlockAImportProgress } from './fixtures/block-a-import-progress';

const root = path.resolve(process.env.BLOCK_A_OUTPUT_ROOT ?? 'output/block-a');
const phase = process.env.BLOCK_A_PHASE ?? 'baseline';
const port = process.env.BLOCK_A_PORT ?? '4541';
const destination = path.join(root, phase);
await fs.mkdir(destination, { recursive: true });
const browser = await chromium.launch();
const inventory: unknown[] = [];

function findScrollableRegions(elements: Element[]) {
  return elements.flatMap((element, index) => {
    if (!(element instanceof HTMLElement) || element.matches('.career-main')) return [];
    const rect = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    const vertical =
      /auto|scroll/.test(css.overflowY) && element.scrollHeight > element.clientHeight + 1;
    const horizontal =
      /auto|scroll/.test(css.overflowX) && element.scrollWidth > element.clientWidth + 1;
    return rect.width > 0 && rect.height > 0 && (vertical || horizontal)
      ? [
          {
            index,
            vertical,
            horizontal,
            className: element.className,
            top: element.scrollTop,
            left: element.scrollLeft,
          },
        ]
      : [];
  });
}

async function captureAdditionalScrolls(page: Page, name: string, width: number) {
  const regions = await page.locator('body *').evaluateAll(findScrollableRegions);
  for (const [regionIndex, region] of regions.entries()) {
    const element = page.locator('body *').nth(region.index);
    for (const axis of ['vertical', 'horizontal'] as const) {
      if (!region[axis]) continue;
      let previous = -1;
      for (let segment = 1; segment <= 100; segment += 1) {
        const position = await element.evaluate((element, axis) => {
          if (axis === 'vertical') element.scrollTop += element.clientHeight;
          else element.scrollLeft += element.clientWidth;
          return axis === 'vertical' ? element.scrollTop : element.scrollLeft;
        }, axis);
        if (position === previous) break;
        previous = position;
        await page.screenshot({
          path: path.join(
            destination,
            `${name}-region-${regionIndex}-${axis}-${segment}-${width}.png`,
          ),
          animations: 'disabled',
        });
      }
    }
    await element.evaluate((element, saved) => {
      element.scrollTop = saved.top;
      element.scrollLeft = saved.left;
    }, region);
  }
  return regions;
}

async function capture(page: Page, name: string, width: number) {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await document.fonts.ready;
    document.querySelector('.career-main')?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(250);
  await captureCareerHarness(page, path.join(destination, `${name}-${width}.html`));
  await page.screenshot({
    path: path.join(destination, `${name}-${width}.png`),
    animations: 'disabled',
    fullPage: false,
  });
  await captureScrollableScreen(page, destination, name, width);
  const regions = await captureAdditionalScrolls(page, name, width);
  inventory.push({
    name,
    width,
    phase,
    regions,
    syntheticNativeProgressEvents:
      width > 760 &&
      name.startsWith('profile-') &&
      name !== 'profile-resume-readonly' &&
      process.env.BLOCK_A_IMPORT_ACTIVE === '1',
  });
  process.stdout.write(`${phase} ${width} ${name}\n`);
}

async function captureToday(page: Page, width: number) {
  const panel = page.locator('.career-expert-panel');
  if (width === 390)
    await page.getByRole('button', { name: 'Консультант: открыть', exact: true }).click();
  else {
    const expand = panel.getByRole('button', { name: 'Развернуть консультанта', exact: true });
    if (await expand.isVisible()) await expand.click();
  }
  await capture(page, 'today-open', width);
  const history = panel.getByRole('button', { name: 'История бесед', exact: true });
  await history.click();
  await capture(page, 'today-history', width);
  await history.click();
  await panel
    .getByRole('button', {
      name:
        width === 390 ? 'Развернуть или свернуть консультанта' : 'Свернуть консультанта в полосу',
      exact: true,
    })
    .click();
  await capture(page, 'today-collapsed', width);
}

async function captureProfile(page: Page, width: number) {
  await page
    .locator(width > 760 ? '.career-rail nav' : '.career-mobile-nav')
    .getByRole('button', { name: 'Профиль', exact: true })
    .click();
  if (width > 900) {
    const expand = page
      .locator('.career-expert-panel')
      .getByRole('button', { name: /^Развернуть консультанта/ });
    if (await expand.isVisible()) await expand.click();
  }
  if (width > 760 && width <= 900) {
    const collapse = page.locator('.career-expert-panel').getByRole('button', {
      name: 'Свернуть консультанта в полосу',
    });
    if (await collapse.isVisible()) await collapse.click();
  }
  const tabs = page.getByRole('tablist', { name: 'Профиль', exact: true });
  await expect(tabs).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#profile-panel-resume')).toBeVisible();
  if (width > 760 && process.env.BLOCK_A_VISUAL_FIXTURE === '1') {
    await capture(page, 'profile-resume-readonly', width);
  }
  if (width > 760 && process.env.BLOCK_A_IMPORT_ACTIVE === '1') {
    await seedBlockAImportProgress(page);
  }
  if (width > 760 && process.env.BLOCK_A_VISUAL_FIXTURE === '1') {
    await page
      .getByRole('button', { name: 'Редактировать место целиком: Маркет Софт', exact: true })
      .click();
  }
  await capture(page, 'profile-resume', width);
  for (const [tab, name] of [
    ['Навыки', 'profile-skills'],
    [width === 390 ? 'След' : 'Цифровой след', 'profile-trace'],
  ]) {
    await tabs.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
    await expect(
      page.locator(name === 'profile-skills' ? '#profile-panel-skills' : '#profile-panel-trace'),
    ).toBeVisible();
    await capture(page, name, width);
  }
}

try {
  const widths = (process.env.BLOCK_A_WIDTHS ?? '1440,390').split(',').map(Number);
  for (const width of widths) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: 'reduce',
    });
    if (process.env.BLOCK_A_VISUAL_FIXTURE === '1') await installBlockAVisualFixture(page);
    else await mockSignedInCabinet(page);
    await page.goto(`http://127.0.0.1:${port}/app`, { waitUntil: 'domcontentloaded' });
    await expect(
      page.locator(
        width > 760
          ? '.career-today-queue-count'
          : '.career-today-mobile .tm-hero:not(.today-loading-hero)',
      ),
    ).toBeVisible({ timeout: 30000 });
    await capture(page, 'today', width);
    await captureToday(page, width);
    await captureProfile(page, width);
    await page.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(
    path.join(destination, 'capture-inventory.json'),
    JSON.stringify(inventory, null, 2),
  );
}
