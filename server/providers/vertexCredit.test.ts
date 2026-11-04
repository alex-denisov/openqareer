import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
import {
  classifyVertexFailure,
  createVertexGate,
  readVertexCreditConfig,
  VertexSkippedError,
  type VertexCreditConfig,
} from './vertexCredit';

const T0 = Date.parse('2026-11-05T10:00:00Z');
const config = (patch: Partial<VertexCreditConfig> = {}): VertexCreditConfig => ({
  creditUsd: 60,
  sinceIso: '2026-11-04T00:00:00.000Z',
  untilMs: Date.parse('2026-11-09T00:00:00Z'),
  dayUsd: 20,
  catalogSummaryDayUsd: 5,
  ...patch,
});
const usage = (cost: number) => ({ cost, promptTokens: 1, cachedTokens: 0, completionTokens: 1 });

describe('настройки кредита Vertex', () => {
  it('по умолчанию 60, с 2026-11-04, до 2026-11-09, 20 в день, 5 на сводки', () => {
    const warn = vi.fn();
    expect(readVertexCreditConfig({}, warn)).toEqual(config());
    expect(warn).not.toHaveBeenCalled();
  });
  it('читает числа, день и полную отметку времени UTC', () => {
    const read = readVertexCreditConfig({
      OPENQAREER_VERTEX_CREDIT_USD: '250',
      OPENQAREER_VERTEX_CREDIT_SINCE: '2026-11-04T12:30:00Z',
      OPENQAREER_VERTEX_CREDIT_UNTIL: '2026-11-10',
      OPENQAREER_VERTEX_DAY_USD: '80',
      OPENQAREER_VERTEX_CATALOG_SUMMARY_DAY_USD: '7.5',
    });
    expect(read).toEqual(
      config({
        creditUsd: 250,
        sinceIso: '2026-11-04T12:30:00.000Z',
        untilMs: Date.parse('2026-11-10T00:00:00Z'),
        dayUsd: 80,
        catalogSummaryDayUsd: 7.5,
      }),
    );
  });
  it.each([
    ['OPENQAREER_VERTEX_CREDIT_USD', 'abc'],
    ['OPENQAREER_VERTEX_CREDIT_USD', '-1'],
    ['OPENQAREER_VERTEX_DAY_USD', '0'],
    ['OPENQAREER_VERTEX_CATALOG_SUMMARY_DAY_USD', 'Infinity'],
    ['OPENQAREER_VERTEX_CREDIT_SINCE', 'вчера'],
    ['OPENQAREER_VERTEX_CREDIT_SINCE', '2026-13-45'],
    ['OPENQAREER_VERTEX_CREDIT_UNTIL', '09.11.2026'],
  ])('%s=%j даёт значение по умолчанию и строку журнала', (key, value) => {
    const warn = vi.fn();
    expect(readVertexCreditConfig({ [key]: value }, warn)).toEqual(config());
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain(key);
  });
});

describe('разбор отказа Vertex', () => {
  it.each([
    [402, 'Payment required'],
    [403, 'BILLING_DISABLED: billing is not enabled'],
    [403, 'This project has no Billing account'],
    [429, 'RESOURCE_EXHAUSTED: prepayment credits are depleted'],
    [429, 'Your budget is exhausted'],
    [400, 'RESOURCE_EXHAUSTED credit balance too low'],
  ])('%i %j - биллинг', (status, text) => {
    expect(classifyVertexFailure(status, text)).toBe('billing');
  });
  it.each([
    [429, 'Resource exhausted. Please try again later.'],
    [429, 'Quota exceeded for requests per minute'],
    [403, 'Permission denied on resource project'],
    [500, 'Internal error'],
    [503, 'The model is overloaded; billing of nothing'],
    [400, 'Invalid JSON schema'],
  ])('%i %j - обычный отказ', (status, text) => {
    expect(classifyVertexFailure(status, text)).toBe('ordinary');
  });
});

describe('ворота Vertex', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });
  const setup = (patch: Partial<VertexCreditConfig> = {}, nowRef = { t: T0 }) => {
    dir = mkdtempSync(join(tmpdir(), 'vgate-'));
    const ledger = new SqliteBulkLlmLedger(join(dir, 'l.db'));
    const transport = vi.fn(async () => new Response('{}', { status: 200 }));
    const log = vi.fn();
    const gate = createVertexGate({
      ledger,
      config: config(patch),
      env: { OPENQAREER_TELEGRAM_BOT_TOKEN: 't', OPENQAREER_TELEGRAM_OWNER_CHAT_ID: '1' },
      transport: transport as never,
      now: () => nowRef.t,
      log,
    });
    return { ledger, gate, transport, log, nowRef };
  };
  const spend = (ledger: SqliteBulkLlmLedger, task: string, cost: number, createdAt?: string) => {
    const id = ledger.recordGeminiCall({ task, model: 'gemini-3.8-flash' }, usage(cost));
    if (createdAt) {
      ledger.db
        .prepare('UPDATE bulk_llm_spend SET created_at=?, day=? WHERE id=?')
        .run(createdAt, createdAt.slice(0, 10), id);
    }
  };

  it('без трат пропускает', () => {
    const { gate } = setup();
    expect(gate.skipReason('roleNames')).toBeUndefined();
  });

  it('credit_expired с 00:00 UTC 9 ноября', () => {
    const { gate, nowRef } = setup();
    nowRef.t = Date.parse('2026-11-08T23:59:59Z');
    expect(gate.skipReason('x')).toBeUndefined();
    nowRef.t = Date.parse('2026-11-09T00:00:00Z');
    expect(gate.skipReason('x')).toBe('credit_expired');
  });

  it('credit_spent считает от SINCE по created_at, а не по дню', () => {
    const { gate, ledger } = setup({ creditUsd: 10, sinceIso: '2026-11-05T09:00:00.000Z' });
    spend(ledger, 'bulk', 6, '2026-11-05T08:59:59.000Z');
    expect(gate.skipReason('x')).toBeUndefined();
    spend(ledger, 'bulk', 6, '2026-11-05T09:30:00.000Z');
    expect(gate.skipReason('x')).toBeUndefined();
    spend(ledger, 'bulk', 4, '2026-11-05T09:40:00.000Z');
    expect(gate.skipReason('x')).toBe('credit_spent');
  });

  it('day_cap: все механики за UTC-день, вчерашнее не считается', () => {
    const { gate, ledger } = setup({ dayUsd: 5 });
    spend(ledger, 'bulk', 9, '2026-11-04T23:00:00.000Z');
    expect(gate.skipReason('x')).toBeUndefined();
    spend(ledger, 'roleNames', 3, '2026-11-05T01:00:00.000Z');
    spend(ledger, 'bulk', 2, '2026-11-05T02:00:00.000Z');
    expect(gate.skipReason('x')).toBe('day_cap');
  });

  it('day_cap считает и траты до SINCE того же дня', () => {
    const { gate, ledger } = setup({ dayUsd: 5, sinceIso: '2026-11-05T09:00:00.000Z' });
    spend(ledger, 'bulk', 6, '2026-11-05T01:00:00.000Z');
    expect(gate.skipReason('x')).toBe('day_cap');
  });

  it('task_day_cap только у catalog-ru-summary', () => {
    const { gate, ledger } = setup({ catalogSummaryDayUsd: 1 });
    spend(ledger, 'catalog-ru-summary', 1.2, '2026-11-05T01:00:00.000Z');
    expect(gate.skipReason('catalog-ru-summary')).toBe('task_day_cap');
    expect(gate.skipReason('bulk')).toBeUndefined();
  });

  it('billing_off: событие в журнале выключает Vertex на 6 часов для другого процесса', () => {
    const { gate, ledger, nowRef } = setup({ untilMs: Date.parse('2099-01-01T00:00:00Z') });
    ledger.event('vertex_billing_off');
    nowRef.t = Date.now() + 5 * 3_600_000;
    expect(gate.skipReason('x')).toBe('billing_off');
    nowRef.t = Date.now() + 6 * 3_600_000 + 60_000;
    expect(gate.skipReason('x')).toBeUndefined();
  });

  it('биллинговый отказ пишет событие, выключает и шлёт Telegram один раз в сутки', async () => {
    const { gate, ledger, transport } = setup();
    gate.failed({ status: 402, text: 'status 402: Payment required' });
    gate.failed({ status: 402, text: 'status 402: Payment required' });
    expect(gate.skipReason('x')).toBe('billing_off');
    expect(ledger.eventSince('vertex_billing_off', '2000-01-01T00:00:00.000Z')).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('обычный отказ охлаждает 60 с, потом 120, 240, 300; успех сбрасывает', () => {
    const { gate, nowRef } = setup();
    const wait = () => {
      const start = nowRef.t;
      gate.failed({ status: 429, text: 'status 429: Resource exhausted' });
      let step = 0;
      while (gate.skipReason('x') === 'cooling') {
        nowRef.t += 1_000;
        step += 1;
      }
      const length = nowRef.t - start;
      nowRef.t = start;
      void step;
      return length;
    };
    const first = wait();
    nowRef.t += first;
    const second = wait();
    nowRef.t += second;
    const third = wait();
    nowRef.t += third;
    const fourth = wait();
    nowRef.t += fourth;
    const fifth = wait();
    expect([first, second, third, fourth, fifth]).toEqual([60_000, 120_000, 240_000, 300_000, 300_000]);
    nowRef.t += fifth;
    gate.succeeded();
    gate.failed({ status: 500, text: 'status 500: boom' });
    nowRef.t += 61_000;
    expect(gate.skipReason('x')).toBeUndefined();
  });

  it('обычный отказ не пишет событие и не шлёт Telegram; 403 без биллинга - тоже обычный, со строкой журнала', () => {
    const { gate, ledger, transport, log } = setup();
    gate.failed({ status: 403, text: 'status 403: Permission denied on project' });
    expect(gate.skipReason('x')).toBe('cooling');
    expect(ledger.eventSince('vertex_billing_off', '2000-01-01T00:00:00.000Z')).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    expect(log.mock.calls.map((call) => String(call[0])).join('\n')).toContain('vertex-forbidden');
  });

  it('400 не охлаждает: запрос плохой, Vertex здоров', () => {
    const { gate } = setup();
    gate.failed({ status: 400, text: 'status 400: Invalid schema' });
    expect(gate.skipReason('x')).toBeUndefined();
  });

  it('сеть и тайм-аут охлаждают', () => {
    const { gate } = setup();
    gate.failed({ text: 'TimeoutError: aborted' });
    expect(gate.skipReason('x')).toBe('cooling');
  });

  it('admit бросает VertexSkippedError с причиной и не зовёт сеть; журнал не чаще раза в минуту', () => {
    const { gate, ledger, log, nowRef } = setup({ creditUsd: 1 });
    spend(ledger, 'bulk', 2, '2026-11-05T09:00:00.000Z');
    for (let index = 0; index < 5; index += 1) {
      expect(() => gate.admit('bulk')).toThrow(VertexSkippedError);
    }
    const lines = () => log.mock.calls.filter((call) => String(call[0]).startsWith('bulk-llm vertex-skip'));
    expect(lines()).toHaveLength(1);
    expect(String(lines()[0]?.[0])).toContain('reason=credit_spent');
    nowRef.t += 61_000;
    expect(() => gate.admit('bulk')).toThrow(/credit_spent/);
    expect(lines()).toHaveLength(2);
  });

  it('credit_spent: один Telegram в сутки на причину, day_cap - отдельный', () => {
    const { gate, ledger, transport } = setup({ creditUsd: 1, dayUsd: 0.5 });
    spend(ledger, 'bulk', 2, '2026-11-05T09:00:00.000Z');
    expect(() => gate.admit('bulk')).toThrow();
    expect(() => gate.admit('bulk')).toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    const second = setup({ creditUsd: 100, dayUsd: 0.5 });
    spend(second.ledger, 'bulk', 2, '2026-11-05T09:00:00.000Z');
    expect(() => second.gate.admit('bulk')).toThrow(/day_cap/);
    expect(second.transport).toHaveBeenCalledTimes(1);
  });
});
