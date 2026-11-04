import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
import { QueuedCampaignRoleModel } from './campaignRoleModel';
import { GeminiLinkedinDraftWriter, QueuedLinkedinDraftWriter } from './linkedinDraftWriter';
import { CANDIDATE_VERTEX_TIMEOUT_MS, createMeteredVertexFetch } from './meteredVertexFetch';
import { createVertexGate, type VertexCreditConfig } from './vertexCredit';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const config: VertexCreditConfig = {
  creditUsd: 1000,
  sinceIso: '2020-01-01T00:00:00.000Z',
  untilMs: Date.parse('2099-01-01T00:00:00Z'),
  dayUsd: 1000,
  catalogSummaryDayUsd: 1000,
};
const input = {
  kind: 'post' as const,
  topic: 'Мой опыт',
  profileHeadline: 'Руководитель',
  facts: [{ ref: 'f1', statement: 'Создал команду' }],
};
const BASE = 'https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google';

function gateAndLedger(patch: Partial<VertexCreditConfig> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vfirst-'));
  dirs.push(dir);
  const ledger = new SqliteBulkLlmLedger(join(dir, 'l.db'));
  return {
    ledger,
    gate: createVertexGate({ ledger, config: { ...config, ...patch }, env: {}, log: vi.fn() }),
  };
}
const fallbackStage = { writeDraft: vi.fn(async () => ({ text: 'Текст второй ступени.' })) };

describe('Vertex первым в механиках, где кандидат ждёт', () => {
  it('потолок ступени Vertex для кандидата короткий', () => {
    expect(CANDIDATE_VERTEX_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    expect(CANDIDATE_VERTEX_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  });

  it('зависший Vertex обрывается потолком, следующая ступень отвечает в общем бюджете', async () => {
    const { gate, ledger } = gateAndLedger();
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as never;
    const vertex = new GeminiLinkedinDraftWriter({
      apiKey: '',
      model: 'gemini-3.8-flash',
      baseUrl: `${BASE}`,
      fetchImpl: createMeteredVertexFetch({
        gate,
        task: 'linkedinDrafts',
        timeoutMs: 30,
        fetchImpl: hanging,
      }),
    });
    const startedAt = Date.now();
    const result = await new QueuedLinkedinDraftWriter([vertex, fallbackStage], 5_000).writeDraft(
      input,
    );
    expect(result.text).toBe('Текст второй ступени.');
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(
      ledger.db.prepare("SELECT status FROM bulk_llm_spend WHERE provider='gemini'").all(),
    ).toEqual([{ status: 'rejected' }]);
  });

  it('закрытые ворота: сети нет, следующая ступень отвечает', async () => {
    const { gate } = gateAndLedger({ untilMs: 1 });
    const inner = vi.fn();
    const vertex = new GeminiLinkedinDraftWriter({
      apiKey: '',
      model: 'gemini-3.8-flash',
      baseUrl: BASE,
      fetchImpl: createMeteredVertexFetch({
        gate,
        task: 'linkedinDrafts',
        fetchImpl: inner as never,
      }),
      authHeaders: async () => ({ Authorization: 'Bearer t' }),
    });
    const result = await new QueuedLinkedinDraftWriter([vertex, fallbackStage]).writeDraft(input);
    expect(result.text).toBe('Текст второй ступени.');
    expect(inner).not.toHaveBeenCalled();
  });

  it('429 у Vertex: повтор не ходит в сеть второй раз (охлаждение), ступень отказывает', async () => {
    const { gate } = gateAndLedger();
    const inner = vi.fn(
      async () => new Response('{"error":{"message":"Resource exhausted"}}', { status: 429 }),
    );
    const vertex = new GeminiLinkedinDraftWriter({
      apiKey: '',
      model: 'gemini-3.8-flash',
      baseUrl: BASE,
      fetchImpl: createMeteredVertexFetch({
        gate,
        task: 'linkedinDrafts',
        fetchImpl: inner as never,
      }),
      authHeaders: async () => ({ Authorization: 'Bearer t' }),
    });
    const startedAt = Date.now();
    const result = await new QueuedLinkedinDraftWriter([vertex, fallbackStage]).writeDraft(input);
    expect(result.text).toBe('Текст второй ступени.');
    expect(inner).toHaveBeenCalledTimes(1);
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });

  it('роли кампании: исключение ворот ведёт к следующей ступени', async () => {
    const { gate } = gateAndLedger({ untilMs: 1 });
    const metered = createMeteredVertexFetch({
      gate,
      task: 'campaignRoles',
      fetchImpl: vi.fn() as never,
    });
    const roles = Array.from({ length: 6 }, (_, index) => ({ title: `Роль ${index}` }));
    const vertexStage = {
      name: 'vertex',
      propose: async () => {
        await metered(`${BASE}/models/m:generateContent`, { method: 'POST' });
        return roles;
      },
    };
    const next = { name: 'next', propose: async () => roles };
    const queue = new QueuedCampaignRoleModel([vertexStage, next]);
    await expect(queue.propose({} as never)).resolves.toEqual(roles);
    expect(queue.name).toBe('next');
  });
});
