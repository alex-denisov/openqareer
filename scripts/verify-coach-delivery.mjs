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

/** Built client + real API/store, synthetic provider and deliberate delivery faults. */
export async function verifyCoachDelivery(page, expert, viewport) {
  let generations = 0;
  let posts = 0;
  const keys = [];
  const retryManually = viewport.name === 'mobile';
  let brokenFull = 0;
  let brokenPart = 0;
  const offsets = [];
  const message = 'Доставка проверена. ' + 'Полный ответ с кириллицей 👨‍💻 и «цитатой». '.repeat(80) + ' Конец полного ответа B198.';
  const { app, store, candidate } = await createFixture(page, message, () => { generations += 1; });
  const pattern = '**/api/v1/coach/**';
  await page.route(pattern, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') { posts += 1; keys.push(request.headers()['idempotency-key']); }
    const response = await app.inject({ method: request.method(), url: url.pathname + url.search,
      headers: { ...request.headers(), authorization: `Bearer ${candidate.accessToken}` },
      ...(request.postData() ? { payload: request.postData() } : {}) });
    let body = response.body;
    if (url.pathname.endsWith('/result') && response.statusCode === 200) {
      if (!url.searchParams.has('offset')) { body = '{"data":'; brokenFull += 1; }
      else {
        const offset = Number(url.searchParams.get('offset'));
        offsets.push(offset);
        if (Buffer.byteLength(body) > 12288) throw new Error('B198 part exceeds route budget');
        if (offset === 8192 && brokenPart < (retryManually ? 2 : 1)) { body = '{"data":'; brokenPart += 1; }
      }
    }
    await route.fulfill({ status: response.statusCode, contentType: 'application/json', body });
  });
  try {
    await expert.locator('textarea').fill('Синтетическая проверка доставки B198.');
    await expert.getByRole('button', { name: 'Отправить вопрос', exact: true }).click();
    if (retryManually) {
      await expert.getByText('Не удалось получить ответ полностью. Повторите попытку.', { exact: true }).waitFor({ timeout: 20_000 });
      await expert.getByRole('button', { name: 'Отправить вопрос', exact: true }).click();
    }
    await expert.getByText(message, { exact: true }).waitFor({ timeout: 20_000 });
    const expectedPosts = retryManually ? 2 : 1;
    if (generations !== 1 || posts !== expectedPosts || new Set(keys).size !== 1 || brokenFull !== expectedPosts || brokenPart !== expectedPosts || offsets.filter((offset) => offset === 8192).length !== expectedPosts + 1) {
      throw new Error(`B198 recovery failed: ${JSON.stringify({ generations, posts, brokenFull, brokenPart, offsets })}`);
    }
    await page.screenshot({ path: `output/playwright/b198-delivery-${viewport.name}.png`, fullPage: true });
    console.log(`coach-delivery: pass ${viewport.name}; one generation, full text, failed part retried`);
  } finally {
    await page.unroute(pattern);
    await app.close();
    store.close();
  }
}
