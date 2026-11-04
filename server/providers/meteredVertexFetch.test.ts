import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
import { createMeteredVertexFetch, vertexBookingId } from './meteredVertexFetch';
import { createVertexGate, VertexSkippedError, type VertexCreditConfig } from './vertexCredit';
import { vertexCallCostUsd } from './vertexPricing';

const URL =
  'https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/gemini-3.8-flash:generateContent';
const answer = (usage: object) =>
  new Response(JSON.stringify({ candidates: [], usageMetadata: usage }), { status: 200 });
const far = Date.parse('2099-01-01T00:00:00Z');
const config: VertexCreditConfig = {
  creditUsd: 1000,
  sinceIso: '2020-01-01T00:00:00.000Z',
  untilMs: far,
  dayUsd: 1000,
  catalogSummaryDayUsd: 1000,
};

describe('цена вызова Vertex по каталогу 28.10', () => {
  it('вход 0.825 и выход 4.125 за 1M, мысли считаются выходом, кэш не удешевляется', () => {
    expect(
      vertexCallCostUsd({
        promptTokenCount: 1_000_000,
        candidatesTokenCount: 100_000,
        thoughtsTokenCount: 100_000,
        cachedContentTokenCount: 500_000,
      }),
    ).toBeCloseTo(0.825 + 0.825, 6);
  });
  it('пустой usageMetadata стоит ноль', () => {
    expect(vertexCallCostUsd(undefined)).toBe(0);
  });
});

describe('обёртка вызова Vertex', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });
  const open = (patch: Partial<VertexCreditConfig> = {}) => {
    dir = mkdtempSync(join(tmpdir(), 'metered-'));
    const ledger = new SqliteBulkLlmLedger(join(dir, 'l.db'));
    const log = vi.fn();
    const gate = createVertexGate({
      ledger,
      config: { ...config, ...patch },
      env: {},
      log,
    });
    return { ledger, gate, log };
  };
  const rows = (ledger: SqliteBulkLlmLedger) =>
    ledger.db
      .prepare(
        'SELECT task,provider,model,status,cost,failure,prompt_tokens,completion_tokens FROM bulk_llm_spend',
      )
      .all() as Record<string, unknown>[];

  it('успех: строка settled с механикой, моделью, токенами и мыслями', async () => {
    const { ledger, gate } = open();
    const inner = vi.fn(async () =>
      answer({ promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 100 }),
    );
    const metered = createMeteredVertexFetch({
      gate,
      task: 'roleNames',
      fetchImpl: inner as never,
    });
    const response = await metered(URL, { method: 'POST' });
    expect(
      ((await response.json()) as { usageMetadata: { promptTokenCount: number } }).usageMetadata
        .promptTokenCount,
    ).toBe(1000);
    expect(rows(ledger)).toEqual([
      {
        task: 'roleNames',
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        status: 'settled',
        cost: (1000 * 0.825 + 300 * 4.125) / 1e6,
        failure: null,
        prompt_tokens: 1000,
        completion_tokens: 300,
      },
    ]);
    expect(vertexBookingId(response)).toBeTypeOf('string');
  });

  it('пропуск воротами: сети нет, строк нет, бросает VertexSkippedError', async () => {
    const { ledger, gate } = open({ creditUsd: 1 });
    ledger.recordGeminiCall(
      { task: 'x', model: 'm' },
      { cost: 2, promptTokens: 1, cachedTokens: 0, completionTokens: 1 },
    );
    const inner = vi.fn();
    const metered = createMeteredVertexFetch({
      gate,
      task: 'roleNames',
      fetchImpl: inner as never,
    });
    await expect(metered(URL, { method: 'POST' })).rejects.toBeInstanceOf(VertexSkippedError);
    await expect(
      metered('https://oauth2.googleapis.com/token', { method: 'POST' }),
    ).rejects.toBeInstanceOf(VertexSkippedError);
    expect(inner).not.toHaveBeenCalled();
    expect(rows(ledger)).toHaveLength(1);
  });

  it('отказ 429: строка rejected, cost 0, причина замаскирована, ответ возвращается, дальше охлаждение', async () => {
    const { ledger, gate } = open();
    const inner = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: 'Quota. Bearer abcdef123456 key=AIzaSyAAAAAAAAAAAAAA' },
          }),
          {
            status: 429,
          },
        ),
    );
    const metered = createMeteredVertexFetch({ gate, task: 'bulk', fetchImpl: inner as never });
    const response = await metered(URL, { method: 'POST' });
    expect(response.status).toBe(429);
    const [row] = rows(ledger);
    expect(row).toMatchObject({ status: 'rejected', cost: 0, provider: 'gemini', task: 'bulk' });
    expect(String(row?.failure)).toContain('status 429');
    expect(String(row?.failure)).not.toContain('abcdef123456');
    expect(String(row?.failure)).not.toContain('AIzaSy');
    await expect(metered(URL, { method: 'POST' })).rejects.toThrow(/cooling/);
    expect(inner).toHaveBeenCalledOnce();
  });

  it('биллинговый отказ выключает Vertex для всех процессов (событие в журнале)', async () => {
    const { ledger, gate } = open();
    const metered = createMeteredVertexFetch({
      gate,
      task: 'bulk',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: { message: 'BILLING_DISABLED' } }), {
          status: 403,
        })) as never,
    });
    await metered(URL, { method: 'POST' });
    expect(ledger.eventSince('vertex_billing_off', '2000-01-01T00:00:00.000Z')).toBe(true);
    await expect(metered(URL, { method: 'POST' })).rejects.toThrow(/billing_off/);
  });

  it('сетевой сбой пишет rejected и охлаждает, ошибка летит дальше', async () => {
    const { ledger, gate } = open();
    const metered = createMeteredVertexFetch({
      gate,
      task: 'bulk',
      fetchImpl: (async () => {
        throw Object.assign(new Error('socket hang up'), { name: 'TypeError' });
      }) as never,
    });
    await expect(metered(URL, { method: 'POST' })).rejects.toThrow(/socket/);
    expect(rows(ledger)[0]).toMatchObject({ status: 'rejected', cost: 0 });
    expect(gate.skipReason('bulk')).toBe('cooling');
  });

  it('пока Vertex охлаждается, вызов закрыт', async () => {
    const { gate } = open();
    gate.failed({ status: 500, text: 'x' });
    const metered = createMeteredVertexFetch({
      gate,
      task: 'bulk',
      fetchImpl: (async () => answer({ promptTokenCount: 1 })) as never,
    });
    await expect(metered(URL, { method: 'POST' })).rejects.toThrow(/cooling/);
  });

  it('запрос токена проходит без строк, ответ 400 не охлаждает', async () => {
    const { ledger, gate } = open();
    const inner = vi.fn(async () => new Response('{}', { status: 400 }));
    const metered = createMeteredVertexFetch({ gate, task: 't', fetchImpl: inner as never });
    await metered('https://oauth2.googleapis.com/token', { method: 'POST' });
    await metered(URL, { method: 'POST' });
    await metered(URL, { method: 'POST' });
    expect(inner).toHaveBeenCalledTimes(3);
    expect(rows(ledger).map((row) => row.status)).toEqual(['rejected', 'rejected']);
  });

  it('потолок времени ступени обрывает зависший вызов', async () => {
    const { gate } = open();
    const metered = createMeteredVertexFetch({
      gate,
      task: 'linkedinDrafts',
      timeoutMs: 20,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        })) as never,
    });
    await expect(metered(URL, { method: 'POST' })).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('сбой записи в журнал не ломает ответ кандидату', async () => {
    const { ledger, gate } = open();
    const broken = Object.assign(Object.create(gate), {
      ledger: Object.assign(Object.create(ledger), {
        recordGeminiCall: () => {
          throw new Error('locked');
        },
      }),
    });
    const metered = createMeteredVertexFetch({
      gate: broken,
      task: 't',
      fetchImpl: (async () => answer({ promptTokenCount: 1, candidatesTokenCount: 1 })) as never,
    });
    expect((await metered(URL, { method: 'POST' })).status).toBe(200);
  });
});
