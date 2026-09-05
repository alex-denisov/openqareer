import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let harness;
async function loadHarness() {
  if (harness) return harness;
  await mkdir('output/b198', { recursive: true });
  const outfile = resolve('output/b198/api-harness.mjs');
  await build({
    stdin: {
      contents: "export { buildApp } from './server/app'; export { SqliteCandidateStore } from './server/data/sqliteCandidateStore';",
      resolveDir: process.cwd(), loader: 'ts',
    }, outfile, bundle: true, platform: 'node', format: 'esm', target: 'node24',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  harness = await import(pathToFileURL(outfile).href);
  return harness;
}

async function createFixture(page, message, onGenerate) {
  const { buildApp, SqliteCandidateStore } = await loadHarness();
  const store = new SqliteCandidateStore({ databasePath: ':memory:', encryptionKey: Buffer.alloc(32, 19) });
  const candidate = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const app = await buildApp({
    config: {
      host: '127.0.0.1', port: 0, openAIKey: '', previewToken: 'synthetic-preview-token-12345678901234567890',
      dataEncryptionKey: Buffer.alloc(32, 19), databasePath: ':memory:', model: 'synthetic',
      staticRoot: '/tmp/unused-b198', release: 'b198-fixture', logLevel: 'fatal',
      secureCookies: false, allowedOrigins: [new URL(page.url()).origin], seedAccounts: [],
    }, candidateStore: store, serveStatic: false,
    authService: { authenticate: () => null, isUsernameTaken: () => false, logout() {},
      register: async () => { throw new Error('not used'); }, login: async () => null },
    coachProvider: { createTurn: async () => {
      onGenerate();
      return { provider: 'openai', model: 'synthetic', responseId: 'synthetic-b198',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        result: { message, phase: 'evidence', memoryCandidates: [], nextQuestion: null,
          completeness: { known: Array(20).fill('Подтверждённый тестовый факт. '.repeat(9)), unknown: [] },
          safety: { needsHuman: false, reason: null }, careerTrack: null, actionProposals: [] } };
    } },
  });
  return { app, store, candidate };
}

function holdHistory(page, started) {
  const releases = [];
  const pattern = '**/api/v1/candidate/me*';
  const handler = async (route) => {
    if (started()) await new Promise((resolve) => releases.push(resolve));
    await route.fallback();
  };
  return {
    start: () => page.route(pattern, handler),
    close: async () => { releases.forEach((release) => release()); await page.unroute(pattern, handler); },
  };
}

async function assertComposerAvailable(expert, page) {
  await expert.locator('textarea').fill('Следующий вопрос');
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Отправить вопрос"]')?.disabled, undefined, { timeout: 3_000 });
  await expert.locator('textarea').fill('');
}

/** Faults the delivery on purpose: a whole broken JSON, then one broken part. */
function corrupt(url, body, state, retryManually) {
  if (!url.searchParams.has('offset')) {
    state.brokenFull += 1;
    return '{"data":';
  }
  const offset = Number(url.searchParams.get('offset'));
  state.offsets.push(offset);
  if (Buffer.byteLength(body) > 12288) throw new Error('B198 part exceeds route budget');
  if (offset === 8192 && state.brokenPart < (retryManually ? 2 : 1)) {
    state.brokenPart += 1;
    return '{"data":';
  }
  return body;
}

function interceptCoach(page, app, candidate, state, retryManually) {
  const pattern = '**/api/v1/coach/**';
  const handler = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') { state.posts += 1; state.keys.push(request.headers()['idempotency-key']); }
    const response = await app.inject({ method: request.method(), url: url.pathname + url.search,
      headers: { ...request.headers(), authorization: `Bearer ${candidate.accessToken}` },
      ...(request.postData() ? { payload: request.postData() } : {}) });
    const body = url.pathname.endsWith('/result') && response.statusCode === 200
      ? corrupt(url, response.body, state, retryManually)
      : response.body;
    await route.fulfill({ status: response.statusCode, contentType: 'application/json', body });
  };
  return { start: () => page.route(pattern, handler), close: () => page.unroute(pattern) };
}

function assertRecovery(state, expectedPosts) {
  const partRetries = state.offsets.filter((offset) => offset === 8192).length;
  if (state.generations !== 1 || state.posts !== expectedPosts || new Set(state.keys).size !== 1
    || state.brokenFull !== expectedPosts || state.brokenPart !== expectedPosts
    || partRetries !== expectedPosts + 1) {
    throw new Error(`B198 recovery failed: ${JSON.stringify(state)}`);
  }
}

/** Built client + real API/store, synthetic provider and deliberate delivery faults. */
export async function verifyCoachDelivery(page, expert, viewport) {
  const state = { generations: 0, posts: 0, keys: [], brokenFull: 0, brokenPart: 0, offsets: [] };
  const retryManually = viewport.name === 'mobile';
  const expectedPosts = retryManually ? 2 : 1;
  const message = 'Доставка проверена. ' + 'Полный ответ с кириллицей 👨‍💻 и «цитатой». '.repeat(80) + ' Конец полного ответа B198.';
  const { app, store, candidate } = await createFixture(page, message, () => { state.generations += 1; });
  // История намеренно не обновляется после отправки: свежий ответ обязан
  // появиться сам по себе, а не дождавшись перезагрузки ленты (B198).
  const history = holdHistory(page, () => state.posts > 0);
  await history.start();
  const coach = interceptCoach(page, app, candidate, state, retryManually);
  await coach.start();
  try {
    await expert.locator('textarea').fill('Синтетическая проверка доставки B198.');
    await expert.getByRole('button', { name: 'Отправить вопрос', exact: true }).click();
    if (retryManually) {
      await expert.getByText('Не удалось получить ответ полностью. Повторите попытку.', { exact: true }).waitFor({ timeout: 20_000 });
      await expert.getByRole('button', { name: 'Отправить вопрос', exact: true }).click();
    }
    await expert.getByText(message, { exact: true }).waitFor({ timeout: 20_000 });
    await assertComposerAvailable(expert, page);
    assertRecovery(state, expectedPosts);
    await page.screenshot({ path: `output/playwright/b198-delivery-${viewport.name}.png`, fullPage: true });
    console.log(`coach-delivery: pass ${viewport.name}; one generation, full text, failed part retried`);
  } finally {
    await history.close();
    await coach.close();
    await app.close();
    store.close();
  }
}
