import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
import {
  createMeteredVertexFetch,
  GeminiDayCapError,
  geminiCapReporter,
  readGeminiDayCapUsd,
} from './meteredVertexFetch';
import { vertexCallCostUsd } from './vertexPricing';

const URL =
  'https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/gemini-3.8-flash:generateContent';
const answer = (usage: object) =>
  new Response(JSON.stringify({ candidates: [], usageMetadata: usage }), { status: 200 });
const spend = { cost: 1, promptTokens: 1, cachedTokens: 0, completionTokens: 1 };

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

describe('потолок Gemini в день: чтение настройки', () => {
  it('по умолчанию 1, верное значение читается', () => {
    expect(readGeminiDayCapUsd({})).toBe(1);
    expect(readGeminiDayCapUsd({ OPENQAREER_BULK_GEMINI_DAY_USD: '2.5' })).toBe(2.5);
  });
  it.each(['abc', '-1', '0', 'Infinity'])('невалидное %j даёт 1 и строку журнала', (value) => {
    const warn = vi.fn();
    expect(readGeminiDayCapUsd({ OPENQAREER_BULK_GEMINI_DAY_USD: value }, warn)).toBe(1);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('обёртка вызова Vertex', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const open = () => {
    dir = mkdtempSync(join(tmpdir(), 'metered-'));
    return new SqliteBulkLlmLedger(join(dir, 'l.db'));
  };

  it('ниже потолка зовёт сеть и пишет строку gemini с механикой и ценой', async () => {
    const ledger = open();
    const inner = vi.fn(async () =>
      answer({ promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 100 }),
    );
    const metered = createMeteredVertexFetch({
      ledger,
      dayUsd: 1,
      task: 'roleNames',
      onCap: vi.fn(),
      fetchImpl: inner as never,
    });
    const response = await metered(URL, { method: 'POST' });
    expect(
      ((await response.json()) as { usageMetadata: { promptTokenCount: number } }).usageMetadata
        .promptTokenCount,
    ).toBe(1000);
    expect(ledger.geminiDaySpentUsd()).toBeCloseTo((1000 * 0.825 + 300 * 4.125) / 1e6, 9);
    expect(
      ledger.db.prepare('SELECT task,provider,model,status FROM bulk_llm_spend').get(),
    ).toMatchObject({
      task: 'roleNames',
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      status: 'settled',
    });
  });

  it('на потолке не зовёт сеть, бросает и сообщает', async () => {
    const ledger = open();
    ledger.recordGeminiCall({ task: 'x', model: 'gemini-3.8-flash' }, spend);
    const inner = vi.fn();
    const onCap = vi.fn();
    const metered = createMeteredVertexFetch({
      ledger,
      dayUsd: 1,
      task: 'roleNames',
      onCap,
      fetchImpl: inner as never,
    });
    await expect(metered(URL, { method: 'POST' })).rejects.toBeInstanceOf(GeminiDayCapError);
    expect(inner).not.toHaveBeenCalled();
    expect(onCap).toHaveBeenCalledWith(1, 1);
  });

  it('запрос токена и ответ с ошибкой не пишут строк', async () => {
    const ledger = open();
    const inner = vi.fn(async () => new Response('{}', { status: 429 }));
    const metered = createMeteredVertexFetch({
      ledger,
      dayUsd: 1,
      task: 't',
      onCap: vi.fn(),
      fetchImpl: inner as never,
    });
    await metered('https://oauth2.googleapis.com/token', { method: 'POST' });
    await metered(URL, { method: 'POST' });
    expect(ledger.geminiDaySpentUsd()).toBe(0);
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it('сбой записи в журнал не ломает ответ кандидату', async () => {
    const broken = {
      geminiDaySpentUsd: () => 0,
      recordGeminiCall: () => {
        throw new Error('locked');
      },
    };
    const inner = vi.fn(async () => answer({ promptTokenCount: 1, candidatesTokenCount: 1 }));
    const metered = createMeteredVertexFetch({
      ledger: broken,
      dayUsd: 1,
      task: 't',
      onCap: vi.fn(),
      fetchImpl: inner as never,
    });
    expect((await metered(URL, { method: 'POST' })).status).toBe(200);
  });
});

describe('сообщение владельцу о потолке', () => {
  it('одно в сутки, простым русским', () => {
    const transport = vi.fn(async () => new Response('{}', { status: 200 }));
    let first = true;
    const report = geminiCapReporter(
      { OPENQAREER_TELEGRAM_BOT_TOKEN: 'tok', OPENQAREER_TELEGRAM_OWNER_CHAT_ID: 'chat' },
      transport as never,
      () => {
        const was = first;
        first = false;
        return was;
      },
    );
    report(1.02, 1);
    report(1.05, 1);
    expect(transport).toHaveBeenCalledOnce();
    const init = (transport.mock.calls[0] as unknown as [string, { body: string }])[1];
    expect(JSON.parse(init.body).text).toMatch(/Gemini/u);
  });
});
