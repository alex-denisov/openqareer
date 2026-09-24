/**
 * Captures the redesigned onboarding wizard (B248 macro layout, B249 slice)
 * at 1440x900 and 390x844, one screenshot per wizard step, against realistic
 * candidate data (six jobs, education, skills, result numbers — mirrors
 * docs/v1-release/tasks/work/B248/onboarding.html).
 *
 * Output: docs/v1-release/tasks/work/B248/impl-shots/onboarding/<step>-<width>.png
 */
import { mkdir, readdir, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { stubOnboardingShell, stubOnboardingImport } from './lib/shellMocks.mjs';

const OUT = 'docs/v1-release/tasks/work/B248/impl-shots/onboarding';
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
];

const RESUME_TEXT =
  'Продуктовый аналитик с шестью годами опыта в ритейле и e-commerce. ' +
  'Руководила аналитикой воронки для команды из 6 продактов, подняла конверсию ' +
  'на 18% за два квартала и нашла утечку бюджета на 9 млн рублей в год. ' +
  'Образование: НИУ ВШЭ, прикладная математика и информатика.';

const problems = [];

async function assertNoEmptyState(page, step) {
  const hasEmptyState = await page.getByText('Пока нечего проверять').count();
  if (hasEmptyState > 0) {
    problems.push(`${step}: empty state "Пока нечего проверять" is showing`);
  }
}

async function assertNoHorizontalScroll(page, step, viewport) {
  if (viewport.width !== 390) return;
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  if (overflow > 1) {
    problems.push(`${step}: 390px viewport overflows by ${overflow}px`);
  }
}

async function shoot(page, step, viewport) {
  await assertNoEmptyState(page, step);
  await assertNoHorizontalScroll(page, step, viewport);
  await page.screenshot({ path: `${OUT}/${step}-${viewport.name}.png`, fullPage: true });
}

/** Walks all six wizard steps once, screenshotting each at one viewport. */
async function walkWizard(page, baseUrl, viewport) {
  await page.goto(`${baseUrl}app`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'С чем разбираемся?' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'PDF резюме' }).click();
  await page.getByRole('button', { name: 'Нет PDF под рукой — вставить текст резюме' }).click();
  await page.getByRole('textbox').fill(RESUME_TEXT);
  await shoot(page, 'step1-source', viewport);

  await page.getByRole('button', { name: /Продолжить/u }).click();
  await page.getByRole('heading', { name: 'Разбираем резюме' }).waitFor({ timeout: 10000 });
  await shoot(page, 'step2-parse', viewport);

  await page.getByRole('button', { name: /Продолжить/u }).click();
  await page.getByRole('heading', { name: 'Проверьте профиль' }).waitFor({ timeout: 10000 });
  await shoot(page, 'step3-review', viewport);

  await page.getByRole('button', { name: /Продолжить/u }).click();
  await page.getByRole('heading', { name: 'На какие роли вас купят' }).waitFor({ timeout: 10000 });
  await shoot(page, 'step4-roles', viewport);

  await page.getByRole('button', { name: /Продолжить/u }).click();
  await page.getByRole('heading', { name: 'География и формат' }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'MENA', exact: true }).click();
  await page.getByRole('button', { name: 'EU', exact: true }).click();
  await shoot(page, 'step5-geo', viewport);

  await page.getByRole('button', { name: /Продолжить/u }).click();
  await page.getByRole('heading', { name: 'Первая подборка готова' }).waitFor({ timeout: 10000 });
  await shoot(page, 'step6-done', viewport);
}

async function clearStaleShots() {
  const stalePrefixes = ['step1-text', 'step1-profile-import-desktop', 'step2-talk'];
  let names = [];
  try {
    names = await readdir(OUT);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => stalePrefixes.some((prefix) => name.startsWith(prefix)))
      .map((name) => rm(`${OUT}/${name}`)),
  );
}

await mkdir(OUT, { recursive: true });
await clearStaleShots();

const server = await preview({ logLevel: 'silent', preview: { host: '127.0.0.1', port: 0 } });
const address = server.httpServer.address();
const baseUrl = `http://127.0.0.1:${address.port}/`;
const browser = await chromium.launch();
try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await stubOnboardingShell(page, { signedIn: true });
    await stubOnboardingImport(page);
    await walkWizard(page, baseUrl, viewport);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

process.stdout.write(`${JSON.stringify({ problems }, null, 2)}\n`);
process.stdout.write(problems.length === 0 ? 'onboarding-shots: pass\n' : 'onboarding-shots: FAIL\n');
process.exit(problems.length === 0 ? 0 : 1);
