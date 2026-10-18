import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
import { installBlockAVisualFixture } from './fixtures/block-a-visual-fixture';
import { captureScrollableScreen } from './block-a-screenshot';

const port = process.env.BLOCK_A_PORT ?? '4543';
const destination = path.resolve(
  process.env.BLOCK_A_CURRENT_OUT ??
    process.env.BLOCK_A_REFERENCE_OUT ??
    path.join(process.env.BLOCK_A_OUTPUT_ROOT ?? '/tmp', 'output', 'block-a', 'current-mobile'),
);
const routes = [
  'home',
  'exp',
  'job',
  'jobedit',
  'jobadd',
  'ats',
  'check',
  'about',
  'edu',
  'proj',
  'lang',
  'reloc',
  'docs',
  'src',
  'skilladd',
] as const;

type ProfileRoute = (typeof routes)[number];
type ApiResponse = { readonly path: string; readonly method: string; readonly status: number };
type CaptureRecord = {
  readonly route: ProfileRoute;
  readonly status: 'captured' | 'failed';
  readonly screenshot?: string;
  readonly geometry?: readonly unknown[];
  readonly scroll?: {
    readonly top: number;
    readonly clientHeight: number;
    readonly scrollHeight: number;
  };
  readonly error?: string;
};

const captureLog: CaptureRecord[] = [];
const apiResponses: ApiResponse[] = [];
const browser = await chromium.launch({ headless: true });

function routePage(page: Page) {
  return page.locator('.career-profile-mobile[data-mobile-profile-page]');
}

async function expectRoute(page: Page, route: ProfileRoute) {
  const profile = routePage(page);
  await expect(profile).toBeVisible({ timeout: 20000 });
  await expect(profile).toHaveAttribute('data-mobile-profile-page', route, { timeout: 20000 });
}

async function openProfile(page: Page) {
  await page
    .locator('.career-mobile-nav')
    .getByRole('button', { name: 'Профиль', exact: true })
    .click();
  await expectRoute(page, 'home');
  await expect(page.locator('#profile-panel-resume')).toBeVisible();
}

async function returnToHome(page: Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await routePage(page).getAttribute('data-mobile-profile-page');
    if (current === 'home') {
      await expect(page.locator('#profile-panel-resume')).toBeVisible();
      return;
    }

    const back = page.getByRole('button', { name: 'Назад', exact: true });
    await expect(back).toBeVisible({ timeout: 10000 });
    await back.click();
    await expect
      .poll(() => routePage(page).getAttribute('data-mobile-profile-page'), { timeout: 10000 })
      .not.toBe(current);
  }

  throw new Error('Не удалось вернуться в профиль через мобильную кнопку «Назад».');
}

async function recoverAfterFailure(page: Page, route: ProfileRoute) {
  if (route === 'home' || route === 'skilladd') return;
  try {
    await returnToHome(page);
  } catch {
    process.stderr.write(`RECOVERY FAILED after ${route}; remaining routes may be unreachable.\\n`);
  }
}

async function clickHomeRow(page: Page, name: RegExp) {
  await page.locator('#profile-panel-resume').getByRole('button', { name }).click();
}

async function navigateTo(page: Page, route: ProfileRoute) {
  if (route === 'home') return;

  if (route === 'skilladd') {
    await page.getByRole('tab', { name: 'Навыки', exact: true }).click();
    await page
      .locator('#profile-panel-skills')
      .getByRole('button', { name: /^Добавить навык/ })
      .click();
  } else if (route === 'job' || route === 'jobedit' || route === 'jobadd') {
    await clickHomeRow(page, /^Опыт/);
    await expectRoute(page, 'exp');
    if (route === 'jobadd') {
      await page.getByRole('button', { name: /^Добавить место работы/ }).click();
    } else {
      await page.getByRole('button', { name: /^Финтех Лаб/ }).click();
      await expectRoute(page, 'job');
      if (route === 'jobedit') {
        await page.getByRole('button', { name: /^Изменить место/ }).click();
      }
    }
  } else {
    const entryNames: Readonly<
      Record<Exclude<ProfileRoute, 'home' | 'skilladd' | 'job' | 'jobedit' | 'jobadd'>, RegExp>
    > = {
      exp: /^Опыт/,
      ats: /^Прохождение ATS/,
      check: /^Проверка/,
      about: /^Обо мне/,
      edu: /^Образование/,
      proj: /^Проекты/,
      lang: /^Языки/,
      reloc: /^Релокация/,
      docs: /^Версии под вакансии/,
      src: /^LinkedIn/,
    };
    await clickHomeRow(page, entryNames[route]);
  }

  await expectRoute(page, route);
  if (route === 'jobedit' || route === 'jobadd') {
    await expect(page.locator('.profile-mobile-position-editor')).toBeVisible();
  }
  if (route === 'skilladd') {
    await expect(page.locator('form.profile-mobile-skill-form')).toBeVisible();
  }
}

async function verifyFixtureResponses(route: ProfileRoute) {
  if (route === 'docs') {
    await expect
      .poll(
        () =>
          apiResponses.some(
            (response) =>
              response.path === '/api/v1/candidate/resume/versions' &&
              response.method === 'GET' &&
              response.status < 400,
          ),
        { timeout: 20000 },
      )
      .toBe(true);
  }
  if (route === 'reloc') {
    await expect
      .poll(
        () =>
          apiResponses.some(
            (response) =>
              response.path === '/api/v1/candidate/relocation-questionnaire' &&
              response.method === 'GET' &&
              response.status < 400,
          ),
        { timeout: 20000 },
      )
      .toBe(true);
  }
}

async function captureRoute(page: Page, route: ProfileRoute) {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await document.fonts.ready;
  });

  const name = `profile-${route}`;
  const screenshot = path.join(destination, `${name}-390.png`);
  const scroll = await page.locator('.career-main').evaluate((main) => ({
    top: main.scrollTop,
    clientHeight: main.clientHeight,
    scrollHeight: main.scrollHeight,
  }));
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  await captureScrollableScreen(page, destination, name, 390);
  const geometry = await page
    .locator('.career-main,.pm-view,.pm-field,.pm-area,.pm-sw,.pm-savebar,.career-mobile-nav')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        className: element.className,
        rect: element.getBoundingClientRect().toJSON(),
        paddingBottom: getComputedStyle(element).paddingBottom,
        minHeight: getComputedStyle(element).minHeight,
        bottom: getComputedStyle(element).bottom,
      })),
    );
  captureLog.push({ route, status: 'captured', screenshot, scroll, geometry });
  process.stdout.write(`CAPTURED ${route} ${screenshot}\n`);
}

try {
  await fs.mkdir(destination, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (
      url.pathname === '/api/v1/candidate/resume/versions' ||
      url.pathname.startsWith('/api/v1/candidate/relocation-questionnaire')
    ) {
      apiResponses.push({
        path: url.pathname,
        method: response.request().method(),
        status: response.status(),
      });
    }
  });

  await installBlockAVisualFixture(page);
  await page.goto(`http://127.0.0.1:${port}/app`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.career-today-mobile .tm-hero:not(.today-loading-hero)')).toBeVisible({
    timeout: 30000,
  });
  await openProfile(page);

  for (const route of routes) {
    try {
      if (route !== 'home') await returnToHome(page);
      await navigateTo(page, route);
      await verifyFixtureResponses(route);
      await captureRoute(page, route);
      if (route !== 'home' && route !== 'skilladd') await returnToHome(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = await routePage(page)
        .getAttribute('data-mobile-profile-page')
        .catch(() => null);
      captureLog.push({
        route,
        status: 'failed',
        error: `${message} (current route: ${current ?? 'unavailable'})`,
      });
      process.stderr.write(
        `FAILED ${route}: ${message} (current route: ${current ?? 'unavailable'})\n`,
      );
      await recoverAfterFailure(page, route);
    }
  }

  await page.close();
} finally {
  await browser.close();
  const log = [
    'Block A mobile profile detail capture',
    `base: http://127.0.0.1:${port}/app`,
    'viewport: 390x844, deviceScaleFactor 1, reduced motion',
    `output: ${destination}`,
    '',
    ...captureLog.map((record) =>
      record.status === 'captured'
        ? `CAPTURED ${record.route}: ${record.screenshot} (main scroll ${record.scroll?.top}/${record.scroll?.scrollHeight}, viewport ${record.scroll?.clientHeight})`
        : `FAILED ${record.route}: ${record.error}`,
    ),
    '',
    'API fixture responses:',
    ...apiResponses.map((response) => `${response.method} ${response.path} -> ${response.status}`),
    '',
  ].join('\n');
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, 'capture.log'), log);
  await fs.writeFile(
    path.join(destination, 'capture-results.json'),
    JSON.stringify({ captures: captureLog, apiResponses }, null, 2),
  );
  process.stdout.write(log);
}

if (captureLog.some((record) => record.status === 'failed')) process.exitCode = 1;
