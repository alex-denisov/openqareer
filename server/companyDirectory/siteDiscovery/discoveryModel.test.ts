import { generateKeyPairSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { backoffMs, discoveryModel, openRouterAsk, SITE_DISCOVERY_TASK } from './discoveryModel';

const KEY = 'sk-or-test-key-000000000000';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = {
  type: 'service_account',
  project_id: 'test-project',
  client_email: 'test@test-project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};
const VERTEX_ENV = {
  OPENQAREER_VERTEX_SERVICE_ACCOUNT_B64: Buffer.from(JSON.stringify(account)).toString('base64'),
  OPENQAREER_OPENROUTER_API_KEY: KEY,
};
function vertexAnswering(status: number, text: string): typeof fetch {
  return (async (input: string | URL | Request) =>
    String(input).includes('oauth2')
      ? json(200, { access_token: 'tok', expires_in: 3600 })
      : json(status, { candidates: [{ content: { parts: [{ text }] } }] })) as typeof fetch;
}

function ledger(spent: number): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(
    `CREATE TABLE bulk_llm_spend(id TEXT PRIMARY KEY, task TEXT, provider TEXT, cost REAL);
     INSERT INTO bulk_llm_spend VALUES ('a', '${SITE_DISCOVERY_TASK}', 'gemini', ${spent});`,
  );
  return db;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const orReply = (text: string) => json(200, { choices: [{ message: { content: text } }] });
const noSleep = async () => {};

describe('B627 discovery model', () => {
  it('retries the free pool on 429, 5xx and network errors without giving up', async () => {
    const answers: (() => Response)[] = [
      () => json(429, {}),
      () => json(503, {}),
      () => {
        throw new TypeError('fetch failed');
      },
      () => orReply('[]'),
    ];
    let calls = 0;
    const fetchImpl = (async () => answers[calls++]!()) as typeof fetch;
    const ask = openRouterAsk(KEY, { fetchImpl, sleep: noSleep });
    expect(await ask('q')).toBe('[]');
    expect(calls).toBe(4);
  });

  it('does not retry a malformed request', async () => {
    const fetchImpl = (async () => json(400, {})) as typeof fetch;
    await expect(openRouterAsk(KEY, { fetchImpl, sleep: noSleep })('q')).rejects.toThrow('status 400');
  });

  it('backs off exponentially with jitter under a ceiling', () => {
    expect(backoffMs(1, () => 0)).toBe(2_000);
    expect(backoffMs(1, () => 1)).toBe(4_000);
    expect(backoffMs(20, () => 1)).toBe(120_000);
  });

  it('uses Vertex under the $40 cap and OpenRouter past it', async () => {
    const vertexFetch = vertexAnswering(200, 'from-vertex');
    const fetchImpl = (async () => orReply('from-free')) as typeof fetch;
    const under = discoveryModel(ledger(39.5), ':memory:', VERTEX_ENV, { vertexFetch, fetchImpl, sleep: noSleep });
    expect(await under!('q')).toEqual({ text: 'from-vertex', route: 'vertex' });
    const over = discoveryModel(ledger(40), ':memory:', VERTEX_ENV, { vertexFetch, fetchImpl, sleep: noSleep });
    expect(await over!('q')).toEqual({ text: 'from-free', route: 'openrouter' });
  });

  it('falls back to the free pool when Vertex fails', async () => {
    const vertexFetch = vertexAnswering(500, '');
    const fetchImpl = (async () => orReply('from-free')) as typeof fetch;
    const ask = discoveryModel(ledger(0), ':memory:', VERTEX_ENV, { vertexFetch, fetchImpl, sleep: noSleep });
    expect((await ask!('q')).route).toBe('openrouter');
  });
});
