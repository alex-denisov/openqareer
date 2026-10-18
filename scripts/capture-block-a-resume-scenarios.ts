import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, type BrowserContext, type Page } from 'playwright';

interface ScenarioState {
  profile: 'normal' | 'empty';
  resumeMode: 'normal' | 'hold' | 'unavailable';
  resumeSaveMode: 'normal' | 'fail-once';
  pendingResumeGets: number;
  normalCandidateId: string;
  emptyCandidateId: string;
  activeCandidateId: string;
}

interface CapturedApiResponse {
  method: string;
  path: string;
  status: number;
  errorCode?: string;
  draftPresent?: boolean;
  savedNameMatchesFixture?: boolean;
}

interface CaptureRecord {
  name: string;
  viewport: { width: number; height: number };
  screenshot: string;
  apiResponses: CapturedApiResponse[];
  checks: string[];
}

const uiOrigin = process.env.BLOCK_A_SCENARIO_UI_ORIGIN ?? 'http://127.0.0.1:4544';
const apiOrigin = process.env.BLOCK_A_SCENARIO_API_ORIGIN ?? 'http://127.0.0.1:4554';
const outputDirectory = process.env.BLOCK_A_SCENARIO_OUTPUT ?? '/tmp/oq-block-a-scenario11';
const viewports = [
  { name: 'desktop-1440', width: 1440, height: 900, mobile: false },
  { name: 'mobile-390', width: 390, height: 844, mobile: true },
] as const;
const fixtureName = 'Синтетический демо-профиль';
const externalNetworkAttempts: string[] = [];

function ensureLoopbackOrigin(value: string, name: string): URL {
  const url = new URL(value);
  assert.equal(url.protocol, 'http:', `${name} must use plain HTTP on loopback`);
  assert.ok(
    url.hostname === '127.0.0.1' || url.hostname === 'localhost',
    `${name} must resolve to loopback`,
  );
  assert.equal(url.pathname, '/', `${name} must be an origin without a path`);
  assert.equal(url.search, '', `${name} must not include a query`);
  assert.equal(url.hash, '', `${name} must not include a fragment`);
  return url;
}

const uiUrl = ensureLoopbackOrigin(uiOrigin, 'UI origin');
const apiUrl = ensureLoopbackOrigin(apiOrigin, 'API origin');

async function readJson(response: { json(): Promise<unknown> }): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function getScenario(): Promise<ScenarioState> {
  const response = await fetch(new URL('/__block-a/scenario', apiUrl));
  assert.equal(response.status, 200, 'demo scenario endpoint must be available');
  return (await readJson(response)) as unknown as ScenarioState;
}

async function setScenario(patch: Partial<ScenarioState>): Promise<ScenarioState> {
  const response = await fetch(new URL('/__block-a/scenario', apiUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  assert.equal(response.status, 200, 'demo scenario change must be accepted');
  const body = await readJson(response);
  return body.scenario as ScenarioState;
}

async function pollUntil<T>(
  description: string,
  inspect: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await inspect();
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${JSON.stringify(last)}`);
}

function attachActualApiForwarding(context: BrowserContext): void {
  context.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.protocol === 'data:' || requestUrl.protocol === 'blob:') {
      await route.continue();
      return;
    }

    const isUiOrigin = requestUrl.hostname === uiUrl.hostname && requestUrl.port === uiUrl.port;
    const isApiOrigin = requestUrl.hostname === apiUrl.hostname && requestUrl.port === apiUrl.port;

    if (isUiOrigin && requestUrl.pathname.startsWith('/api/')) {
      if (
        route.request().method() === 'PUT' &&
        requestUrl.pathname === '/api/v1/candidate/resume'
      ) {
        const scenario = await getScenario();
        assert.equal(
          scenario.profile,
          'empty',
          'the capture harness refuses to save over the normal synthetic candidate',
        );
      }
      requestUrl.protocol = apiUrl.protocol;
      requestUrl.hostname = apiUrl.hostname;
      requestUrl.port = apiUrl.port;
      await route.continue({ url: requestUrl.toString() });
      return;
    }

    if (isUiOrigin || isApiOrigin) {
      await route.continue();
      return;
    }

    externalNetworkAttempts.push(requestUrl.origin);
    await route.abort('blockedbyclient');
  });
}

async function createScenarioPage(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  viewport: (typeof viewports)[number],
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    reducedMotion: 'reduce',
  });
  attachActualApiForwarding(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(20_000);
  return { context, page };
}

async function waitForShell(page: Page): Promise<void> {
  await page.goto(new URL('/app', uiUrl).toString(), { waitUntil: 'domcontentloaded' });
  await page
    .locator('[data-testid="career-shell"]:not(.career-bootstrap-shell)')
    .waitFor({ state: 'visible', timeout: 20_000 });
}

async function openProfile(page: Page, viewport: (typeof viewports)[number]): Promise<void> {
  const navigation = page.locator(viewport.mobile ? '.career-mobile-nav' : '.career-rail nav');
  await navigation.getByRole('button', { name: 'Профиль', exact: true }).click();
}

async function saveScreenshot(
  page: Page,
  record: CaptureRecord,
  screenshotName: string,
): Promise<void> {
  const screenshot = path.join(outputDirectory, `${screenshotName}.png`);
  await page.screenshot({
    path: screenshot,
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
  });
  record.name = screenshotName;
  record.viewport = { width: page.viewportSize()!.width, height: page.viewportSize()!.height };
  record.screenshot = path.basename(screenshot);
}

function newRecord(): CaptureRecord {
  return {
    name: '',
    viewport: { width: 0, height: 0 },
    screenshot: '',
    apiResponses: [],
    checks: [],
  };
}

async function captureLoadingState(
  page: Page,
  viewport: (typeof viewports)[number],
  record: CaptureRecord,
): Promise<void> {
  await page.getByText('Загружаем профиль…', { exact: true }).waitFor({ state: 'visible' });
  await pollUntil(
    'a held resume request from the real API',
    async () => (await getScenario()).pendingResumeGets,
    (pending) => pending > 0,
  );
  record.checks.push('profile request held by demo scenario controller');
  await saveScreenshot(page, record, `profile-loading-${viewport.name}`);
}

async function captureErrorState(
  page: Page,
  viewport: (typeof viewports)[number],
  record: CaptureRecord,
): Promise<CaptureRecord> {
  const failedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/candidate/resume' &&
      response.request().method() === 'GET' &&
      response.status() === 503,
  );
  await setScenario({ resumeMode: 'unavailable' });
  const response = await failedResponse;
  const body = await readJson(response);
  const errorBody = body.error as { code?: string } | undefined;
  assert.equal(errorBody?.code, 'block_a_demo_resume_unavailable');
  record.apiResponses.push({
    method: 'GET',
    path: '/api/v1/candidate/resume',
    status: response.status(),
    errorCode: errorBody?.code,
  });
  const error = page.getByRole('alert');
  await error.waitFor({ state: 'visible' });
  await error.getByRole('button', { name: 'Повторить', exact: true }).waitFor({ state: 'visible' });
  record.checks.push('error alert follows actual demo API 503');
  const errorRecord = {
    ...record,
    apiResponses: [...record.apiResponses],
    checks: [...record.checks],
  };
  await saveScreenshot(page, errorRecord, `profile-error-${viewport.name}`);
  return errorRecord;
}

async function retryProfileLoad(page: Page, record: CaptureRecord): Promise<void> {
  await setScenario({ resumeMode: 'normal' });
  const retryResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/candidate/resume' &&
      response.request().method() === 'GET' &&
      response.status() === 200,
  );
  await page.getByRole('alert').getByRole('button', { name: 'Повторить', exact: true }).click();
  const response = await retryResponse;
  record.apiResponses.push({
    method: 'GET',
    path: '/api/v1/candidate/resume',
    status: response.status(),
    draftPresent: true,
  });
  await page.locator('#profile-panel-resume').waitFor({ state: 'visible' });
  record.checks.push('retry succeeds with actual API 200');
}

async function captureLoadingAndError(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  viewport: (typeof viewports)[number],
): Promise<CaptureRecord[]> {
  const record = newRecord();
  const { context, page } = await createScenarioPage(browser, viewport);
  try {
    await setScenario({ profile: 'normal', resumeMode: 'normal', resumeSaveMode: 'normal' });
    await waitForShell(page);
    await setScenario({ resumeMode: 'hold' });
    await openProfile(page, viewport);
    await captureLoadingState(page, viewport, record);
    const errorRecord = await captureErrorState(page, viewport, record);
    await retryProfileLoad(page, record);
    return [record, errorRecord];
  } finally {
    await context.close();
  }
}

async function captureEmptyProfile(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  viewport: (typeof viewports)[number],
): Promise<{ record: CaptureRecord; context: BrowserContext; page: Page }> {
  const record = newRecord();
  const { context, page } = await createScenarioPage(browser, viewport);
  await setScenario({ profile: 'empty', resumeMode: 'normal', resumeSaveMode: 'normal' });
  await waitForShell(page);
  const emptyResumeResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/candidate/resume' &&
      response.request().method() === 'GET',
  );
  await openProfile(page, viewport);
  const response = await emptyResumeResponse;
  assert.equal(response.status(), 200, 'empty state must come from a real API response');
  const payload = (await response.json()) as { data?: { draft?: unknown; savedAt?: unknown } };
  assert.equal(payload.data?.draft, null, 'empty candidate must have a persisted draft:null');
  assert.equal(payload.data?.savedAt, null, 'empty candidate must have no persisted save time');
  record.apiResponses.push({
    method: 'GET',
    path: '/api/v1/candidate/resume',
    status: response.status(),
    draftPresent: false,
  });
  await page
    .getByText('Профиль пока пуст. Подключите источник резюме или заполните разделы вручную.', {
      exact: true,
    })
    .waitFor({ state: 'visible' });
  record.checks.push('empty state follows actual GET 200 with draft:null and savedAt:null');
  await saveScreenshot(page, record, `profile-empty-${viewport.name}`);
  return { record, context, page };
}

async function openNameEditor(page: Page): Promise<{
  dialog: import('playwright').Locator;
  input: import('playwright').Locator;
  save: import('playwright').Locator;
}> {
  await page.getByRole('button', { name: 'Заполнить профиль вручную', exact: true }).click();
  await page.getByRole('button', { name: 'Имя', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Имя', exact: true });
  const input = dialog.getByRole('textbox', { name: 'Имя', exact: true });
  await input.fill(fixtureName);
  const save = dialog.getByRole('button', { name: 'Сохранить', exact: true });
  return { dialog, input, save };
}

async function captureSaveFailure(
  record: CaptureRecord,
  dialog: import('playwright').Locator,
  input: import('playwright').Locator,
  save: import('playwright').Locator,
): Promise<CaptureRecord> {
  const failedResponse = dialog
    .page()
    .waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/candidate/resume' &&
        response.request().method() === 'PUT' &&
        response.status() === 503,
    );
  await save.click();
  const response = await failedResponse;
  const body = await readJson(response);
  const errorBody = body.error as { code?: string } | undefined;
  assert.equal(errorBody?.code, 'block_a_demo_resume_save_unavailable');
  await dialog.getByRole('alert').waitFor({ state: 'visible' });
  assert.equal(await input.inputValue(), fixtureName, 'failed save must retain entered text');
  record.apiResponses.push({
    method: 'PUT',
    path: '/api/v1/candidate/resume',
    status: response.status(),
    errorCode: errorBody?.code,
  });
  record.checks.push('failed save retains text after actual one-shot 503');
  const errorRecord = {
    ...record,
    apiResponses: [...record.apiResponses],
    checks: [...record.checks],
  };
  await saveScreenshot(dialog.page(), errorRecord, 'profile-save-error-desktop-1440');
  return errorRecord;
}

async function captureSaveRetry(
  record: CaptureRecord,
  page: Page,
  save: import('playwright').Locator,
): Promise<CaptureRecord> {
  const successfulSave = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/candidate/resume' &&
      response.request().method() === 'PUT' &&
      response.status() === 200,
  );
  await save.click();
  const putResponse = await successfulSave;
  record.apiResponses.push({
    method: 'PUT',
    path: '/api/v1/candidate/resume',
    status: putResponse.status(),
    draftPresent: true,
  });
  const persisted = await page.evaluate(async () => {
    const response = await fetch('/api/v1/candidate/resume');
    return { status: response.status, body: await response.json() };
  });
  assert.equal(persisted.status, 200);
  const payload = persisted.body as {
    data?: { draft?: { candidate?: { fullName?: string } } | null };
  };
  assert.equal(payload.data?.draft?.candidate?.fullName, fixtureName);
  record.apiResponses.push({
    method: 'GET',
    path: '/api/v1/candidate/resume',
    status: persisted.status,
    draftPresent: true,
    savedNameMatchesFixture: true,
  });
  record.checks.push('retry PUT 200 and subsequent GET read the persisted fixture name');
  const successRecord = {
    ...record,
    apiResponses: [...record.apiResponses],
    checks: [...record.checks],
  };
  await saveScreenshot(page, successRecord, 'profile-save-success-desktop-1440');
  return successRecord;
}

async function captureEmptySaveFailureAndRetry(
  record: CaptureRecord,
  page: Page,
): Promise<CaptureRecord[]> {
  await setScenario({ profile: 'empty', resumeMode: 'normal', resumeSaveMode: 'fail-once' });
  const { dialog, input, save } = await openNameEditor(page);
  const errorRecord = await captureSaveFailure(record, dialog, input, save);
  const successRecord = await captureSaveRetry(record, page, save);
  return [errorRecord, successRecord];
}

async function verifyFootprintProviderBlock(): Promise<{ status: number; code?: string }> {
  const response = await fetch(new URL('/api/v1/candidate/footprint/start', apiUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: uiUrl.origin },
    body: JSON.stringify({ selectedQueryIds: [] }),
  });
  const body = await readJson(response);
  const error = body.error as { code?: string } | undefined;
  assert.equal(response.status, 503, 'demo footprint start must be blocked before adapters run');
  assert.equal(error?.code, 'block_a_demo_footprint_providers_disabled');
  return { status: response.status, code: error?.code };
}

async function captureScenarios(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<CaptureRecord[]> {
  const captures: CaptureRecord[] = [];
  for (const viewport of viewports) {
    captures.push(...(await captureLoadingAndError(browser, viewport)));
  }
  const emptyCaptures: Array<Awaited<ReturnType<typeof captureEmptyProfile>>> = [];
  for (const viewport of viewports) {
    emptyCaptures.push(await captureEmptyProfile(browser, viewport));
  }
  captures.push(...emptyCaptures.map(({ record }) => record));
  const desktopEmpty = emptyCaptures.find(({ record }) => record.viewport.width === 1440);
  assert.ok(desktopEmpty, 'desktop empty-state context is required for save checks');
  captures.push(...(await captureEmptySaveFailureAndRetry(desktopEmpty.record, desktopEmpty.page)));
  await Promise.all(emptyCaptures.map(({ context }) => context.close()));
  return captures;
}

async function validateDemoAndFootprintBlock(): Promise<{
  initialScenario: { normalCandidateId?: unknown } | undefined;
  footprintBlock: { status: number; code?: string };
}> {
  const metadataResponse = await fetch(new URL('/__block-a/state', apiUrl));
  assert.equal(metadataResponse.status, 200, 'demo API must be running before capture');
  const metadata = await readJson(metadataResponse);
  assert.equal(metadata.synthetic, true, 'demo capture must use synthetic candidates');
  assert.equal(metadata.providerCallsEnabled, false, 'provider calls must remain disabled');
  assert.equal(metadata.footprintProviderCallsBlocked, true);
  const initialScenario = metadata.scenario as { normalCandidateId?: unknown } | undefined;
  const footprintBlock = await verifyFootprintProviderBlock();
  return { initialScenario, footprintBlock };
}

async function writeCaptureManifest(
  captures: CaptureRecord[],
  initialScenario: { normalCandidateId?: unknown } | undefined,
  footprintBlock: { status: number; code?: string },
  finalState: ScenarioState,
): Promise<void> {
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    evidenceType: 'local demo scenario captures; not approved full-screen references',
    uiOrigin: uiUrl.origin,
    apiOrigin: apiUrl.origin,
    candidateScope: 'synthetic normal and empty candidates only',
    providerPolicy: {
      providerCallsEnabled: false,
      footprintStart: footprintBlock,
      externalBrowserRequests: 'blocked and asserted absent',
    },
    viewports: viewports.map(({ name, width, height }) => ({ name, width, height })),
    captures,
    finalScenario: {
      profile: finalState.profile,
      resumeMode: finalState.resumeMode,
      resumeSaveMode: finalState.resumeSaveMode,
      normalCandidateIdUnchanged:
        finalState.normalCandidateId === initialScenario?.normalCandidateId,
    },
  };
  await writeFile(
    path.join(outputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\\n`,
  );
}

async function main(): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  const { initialScenario, footprintBlock } = await validateDemoAndFootprintBlock();
  const browser = await chromium.launch({ headless: true });
  let captures: CaptureRecord[] = [];
  try {
    captures = await captureScenarios(browser);
  } finally {
    await setScenario({ profile: 'normal', resumeMode: 'normal', resumeSaveMode: 'normal' });
    await browser.close();
  }
  const finalState = await getScenario();
  assert.equal(finalState.profile, 'normal');
  assert.equal(finalState.resumeMode, 'normal');
  assert.equal(finalState.resumeSaveMode, 'normal');
  assert.deepEqual(
    externalNetworkAttempts,
    [],
    'the local capture must not attempt external network requests',
  );
  await writeCaptureManifest(captures, initialScenario, footprintBlock, finalState);
  console.log(`Wrote ${captures.length} local scenario screenshots to ${outputDirectory}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
