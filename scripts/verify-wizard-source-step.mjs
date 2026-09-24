/**
 * Walks the changed wizard flows in real Chromium against the built bundle.
 *
 * Covers, at 1440x900 and 390x844:
 *  - step 3 with the seven regions the owner named (B158);
 *  - step 2 on the web, which must offer the desktop CTA and no platform login;
 *  - step 2 in the desktop shell with hh.ru already connected: the release
 *    notice under the cards, «Отключить» in place of «Подключить», and the
 *    DELETE the button must actually issue (B169).
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'mobile-390', width: 390, height: 844 },
];

const OUT = 'output/playwright';

const CONNECTED_HH = {
  platform: 'hh',
  available: true,
  capabilities: ['resume_read'],
  importsCareerHistory: true,
  status: 'connected',
  accessMode: 'native_session_snapshot',
  connectedAt: '2026-08-26T00:00:00.000Z',
  lastImportedAt: '2026-08-26T00:00:00.000Z',
  factCount: 14,
};

const DISCONNECTED_LINKEDIN = {
  platform: 'linkedin',
  available: true,
  capabilities: ['profile_read'],
  importsCareerHistory: true,
  status: 'disconnected',
};

const problems = [];
const deletes = [];

function watch(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${label} console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`${label} pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    problems.push(`${label} requestfailed: ${request.url()}`);
  });
}

const JSON_HEADERS = { status: 200, contentType: 'application/json' };

function json(data) {
  return { ...JSON_HEADERS, body: JSON.stringify({ data }) };
}

/** The row the connections endpoint returns once a platform is released. */
function asDisconnected(connection) {
  return {
    platform: connection.platform,
    available: connection.available,
    capabilities: connection.capabilities,
    importsCareerHistory: connection.importsCareerHistory,
    status: 'disconnected',
  };
}

const RELEASED_RECEIPT = {
  platform: 'hh',
  status: 'disconnected',
  accessMode: 'native_session_snapshot',
  connectionRemoved: true,
  providerSession: 'not_managed',
  importedData: 'retained',
};

function isDisconnectRequest(request, pathname) {
  return request.method() === 'DELETE' && pathname.includes('/candidate/connections/');
}

/**
 * The candidate API, as far as this walk needs it: a session, a connection list
 * that really changes when a platform is released, and nothing else.
 */
async function stubApi(page, { signedIn, connections }) {
  let live = connections ?? [];
  const session = signedIn
    ? { username: 'candidate.test', role: 'candidate', candidateId: 'candidate-wizard-check' }
    : null;
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (isDisconnectRequest(request, pathname)) {
        deletes.push(pathname);
        live = live.map((item) =>
          pathname.endsWith(`/${item.platform}`) ? asDisconnected(item) : item,
        );
        return route.fulfill(json(RELEASED_RECEIPT));
      }
      if (pathname.startsWith('/api/v1/auth')) return route.fulfill(json(session));
      if (pathname.endsWith('/candidate/connections')) return route.fulfill(json(live));
      return route.fulfill(json(null));
    },
  );
}

async function overflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return { horizontal: doc.scrollWidth - doc.clientWidth };
  });
}

async function assertVisible(page, locator, what) {
  if (!(await locator.first().isVisible().catch(() => false))) {
    problems.push(`missing: ${what}`);
  }
}

/** Opens the wizard, which opens on the source step since B249. */
async function reachSourceStep(page, baseUrl) {
  await page.goto(`${baseUrl}app`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'С чем разбираемся?' }).waitFor({ timeout: 20000 });
}

async function isBelow(page, selector, anchorSelector) {
  const box = await page.locator(selector).boundingBox();
  const anchor = await page.locator(anchorSelector).boundingBox();
  if (!box || !anchor) return false;
  return box.y > anchor.y + anchor.height - 1;
}

/** 5) Automation runs from the candidate's own machine, so the web offers no login. */
async function checkWebOffersNoPlatformLogin(page, viewport) {
  await page.getByRole('button', { name: 'Профиль LinkedIn' }).click();
  await assertVisible(
    page,
    page.getByText('Профили на площадках подключаются в приложении для компьютера'),
    `web ${viewport.name}: desktop CTA on the profile-import source`,
  );
  for (const name of ['Подключить', 'Отключить', 'Обновить импорт']) {
    if ((await page.getByRole('button', { name, exact: true }).count()) > 0) {
      problems.push(`web ${viewport.name}: platform action «${name}» offered on the web`);
    }
  }
  await page.screenshot({ path: `${OUT}/web-${viewport.name}-step2.png` });
}

/** The release notice renders under the source it describes, not against the buttons. */
async function checkSourceLockSitsUnderItsSource(page, viewport) {
  await page.getByRole('button', { name: 'PDF резюме' }).click();
  await page.getByRole('button', { name: 'Нет PDF под рукой — вставить текст резюме' }).click();
  await page
    .getByRole('textbox')
    .fill(
      'Руководил продуктовой командой из восьми человек, отвечал за выручку направления и запустил три новых продукта за два года подряд.',
    );
  await assertVisible(
    page,
    page.getByRole('button', { name: 'Сменить источник' }),
    `web ${viewport.name}: release control under the locked source`,
  );
  if (!(await isBelow(page, '.career-source-lock', '.career-onboarding-source-grid'))) {
    problems.push(`web ${viewport.name}: release notice still sits against the source cards`);
  }
  await page.screenshot({ path: `${OUT}/web-${viewport.name}-step2-lock.png` });
}

const EXPECTED_REGIONS = ['Россия', 'СНГ', 'US', 'EU', 'MENA', 'APAC', 'LATAM'];

/**
 * 2) Step five ("География и формат") offers exactly the seven regions the
 * owner named — reached via the "расскажу сам" branch, which skips the
 * document steps entirely (onboarding.html step 2b/talk).
 */
async function checkRegionsOnStepFive(page, viewport) {
  await page.getByRole('button', { name: 'Сменить источник' }).click();
  await page.getByRole('button', { name: 'Расскажу сам' }).click();
  await page.getByRole('button', { name: /Продолжить/u }).click();
  await page
    .getByRole('heading', { name: 'Три вопроса о последней роли' })
    .waitFor({ timeout: 10000 });
  const [q1, q2, q3] = await page.getByRole('textbox').all();
  await q1.fill(
    'Руководил продуктовой командой из восьми человек и отвечал за выручку направления.',
  );
  await q2.fill('Меньше операционки, больше стратегии.');
  await q3.fill('Команда выросла вдвое.');
  await page.getByRole('button', { name: /Продолжить/u }).click();
  await page.getByRole('heading', { name: 'Проверьте профиль' }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Продолжить/u }).click();
  await page.getByRole('heading', { name: 'На какие роли вас купят' }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Продолжить/u }).click();
  await page.getByRole('heading', { name: 'География и формат' }).waitFor({ timeout: 10000 });

  const regions = await page
    .getByRole('group', { name: 'Где рассматриваете работу' })
    .getByRole('button')
    .allInnerTexts();
  if (JSON.stringify(regions.map((item) => item.trim())) !== JSON.stringify(EXPECTED_REGIONS)) {
    problems.push(`${viewport.name}: regions are ${JSON.stringify(regions)}`);
  }
  const eu = page.getByRole('button', { name: 'EU', exact: true });
  await eu.click();
  if ((await eu.getAttribute('aria-pressed')) !== 'true') {
    problems.push(`${viewport.name}: EU does not select`);
  }
  const wide = await overflow(page);
  if (wide.horizontal > 1) {
    problems.push(`${viewport.name}: step 5 overflows by ${wide.horizontal}px`);
  }
  await page.screenshot({ path: `${OUT}/web-${viewport.name}-step5.png` });
}

/** 3) A connected platform shows its sign-out where «Подключить» used to be. */
async function checkConnectedCardState(page, viewport) {
  await page.getByRole('button', { name: 'Отключить', exact: true }).waitFor({ timeout: 10000 });
  if ((await page.getByText('Обновить импорт').count()) > 0) {
    problems.push(`desktop ${viewport.name}: «Обновить импорт» survived`);
  }
  if ((await page.getByText('Резюме разобрано').count()) > 0) {
    problems.push(`desktop ${viewport.name}: parsed-resume banner survived`);
  }
  // «Отключить» on the card is the release control. The separate plate was a
  // second door to the same room and the owner read them as duplicates
  // (owner report, 2026-08-26; B171).
  if ((await page.locator('.career-source-lock').count()) > 0) {
    problems.push(`desktop ${viewport.name}: the duplicated «Сменить источник» plate survived`);
  }
  // The other platform is shut, and says which connection to release first.
  const otherConnect = page
    .locator('.career-platform-card', { hasText: 'LinkedIn' })
    .getByRole('button', { name: /Подключить/u });
  if ((await otherConnect.getAttribute('aria-disabled')) !== 'true') {
    problems.push(`desktop ${viewport.name}: LinkedIn stayed connectable under a connected hh.ru`);
  }
  const reason = (await otherConnect.getAttribute('title')) ?? '';
  if (!reason.includes('сначала отключите hh.ru')) {
    problems.push(`desktop ${viewport.name}: the closed LinkedIn card gives no reason on hover`);
  }
  const wide = await overflow(page);
  if (wide.horizontal > 1) {
    problems.push(`desktop ${viewport.name}: step 2 overflows by ${wide.horizontal}px`);
  }
  await page.screenshot({ path: `${OUT}/desktop-${viewport.name}-step2.png` });
}

/** «Отключить» releases the connection the account really holds — one DELETE. */
async function checkSignOutReleasesTheConnection(page, viewport) {
  const before = deletes.length;
  await page.getByRole('button', { name: 'Отключить', exact: true }).click();
  await page
    .locator('.career-platform-card', { hasText: 'hh.ru' })
    .getByRole('button', { name: 'Подключить', exact: true })
    .waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  const fired = deletes.length - before;
  if (fired !== 1) {
    problems.push(`desktop ${viewport.name}: «Отключить» issued ${fired} DELETE(s), expected 1`);
  }
  await page.screenshot({ path: `${OUT}/desktop-${viewport.name}-step2-released.png` });
}

async function webWalk(browser, baseUrl, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  watch(page, `web/${viewport.name}`);
  await stubApi(page, { signedIn: false });
  await reachSourceStep(page, baseUrl);
  await checkWebOffersNoPlatformLogin(page, viewport);
  await checkSourceLockSitsUnderItsSource(page, viewport);
  await checkRegionsOnStepFive(page, viewport);
  await context.close();
}

async function desktopWalk(browser, baseUrl, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  await page.addInitScript(installDesktopApiTestBridge);
  watch(page, `desktop/${viewport.name}`);
  await page.addInitScript(() => {
    // What `isTauriEnvironment()` reads to decide it is inside the app.
    window.__TAURI_INTERNALS__ = { invoke: async () => null };
    localStorage.setItem('openqareer_session_token', 'desktop-wizard-source-session');
  });
  await stubApi(page, {
    signedIn: true,
    connections: [DISCONNECTED_LINKEDIN, CONNECTED_HH],
  });
  await reachSourceStep(page, baseUrl);
  await checkConnectedCardState(page, viewport);
  await checkSignOutReleasesTheConnection(page, viewport);
  await context.close();
}

await mkdir(OUT, { recursive: true });

const server = await preview({
  logLevel: 'silent',
  preview: { host: '127.0.0.1', port: 0 },
});
const address = server.httpServer.address();
const baseUrl = `http://127.0.0.1:${address.port}/`;
const browser = await chromium.launch();
try {
  for (const viewport of VIEWPORTS) {
    await webWalk(browser, baseUrl, viewport);
    await desktopWalk(browser, baseUrl, viewport);
  }
} finally {
  await browser.close();
  await server.close();
}

process.stdout.write(`${JSON.stringify({ deletes, problems }, null, 2)}\n`);
process.stdout.write(
  problems.length === 0 ? 'wizard-source-step: pass\n' : 'wizard-source-step: FAIL\n',
);
process.exit(problems.length === 0 ? 0 : 1);
import { installDesktopApiTestBridge } from './desktop-api-test-bridge.mjs';
