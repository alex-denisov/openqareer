import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIGRATION_23,
  VACANCY_CATALOG_ENTRIES_TABLE,
  VACANCY_POOL_INDEX_TABLE,
} from '../data/sqliteSchema';
import { BULK_BUDGET_EXCEEDED, type BulkLlmInput } from '../providers/bulkLlmClient';
import { CATALOG_RU_SUMMARY_VERSION, catalogSummarySourceHash } from './catalogRuSummary';
import {
  CatalogRuSummaryJob,
  sqliteCatalogRuSummarySpend,
  type CatalogRuSummaryLimits,
} from './catalogRuSummaryJob';
import { CatalogRuSummaryStore, SUMMARY_RECHECK_MS } from './catalogRuSummaryStore';

const NOW = Date.parse('2026-11-03T10:00:00Z');
const DAY = 86_400_000;
const TEXT =
  'Компания ищет бухгалтера на участок первичной документации. Работа в офисе в Москве, полный день. ' +
  'Требуется опыт работы в 1С от 3 лет и знание налогового учёта. Оформление по ТК РФ, 120 000 рублей. ' +
  'Будет плюсом опыт работы с маркетплейсами.';
const ANSWER = JSON.stringify({
  summary:
    'Компании нужен бухгалтер на первичную документацию. Работа в московском офисе на полный день. ' +
    'Важен опыт в 1С и понимание налогового учёта.',
  role: 'Бухгалтер',
  format: 'Офис, полный день',
  geography: 'Москва',
  requirements: ['Опыт работы в 1С', 'Налоговый учёт'],
  audience: 'Бухгалтеру с опытом первичной документации.',
});

const limits: CatalogRuSummaryLimits = {
  dayUsd: 1,
  dayCalls: 100,
  channelDayUsd: 20,
  channelMonthUsd: 100,
  channelShare: 0.75,
};

let database: DatabaseSync;
let store: CatalogRuSummaryStore;

function addCard(
  id: string,
  options: { publishedMs: number; text?: string; salary?: string | null; expired?: boolean },
) {
  database
    .prepare(
      `INSERT INTO catalog_entries (cluster_id, entry_key, path, title, company, location, is_remote, salary_label,
         summary, skills_json, source_url, source_name, published_at, last_seen_at, source_count, status,
         role_slug, published_ms, last_seen_ms)
       VALUES (?, ?, ?, 'Бухгалтер', 'ГК Мебетек', 'Москва', 0, ?, '', '[]', 'https://hh.ru/vacancy/1', 'hh.ru',
         ?, ?, 1, 'active', 'buhgalter', ?, ?)`,
    )
    .run(
      `cluster-${id}`,
      id,
      `/vacancies/job/${id}`,
      options.salary === undefined ? 'от 120 000 ₽' : options.salary,
      new Date(options.publishedMs).toISOString(),
      new Date(NOW).toISOString(),
      options.publishedMs,
      NOW,
    );
  database
    .prepare(
      `INSERT INTO vacancy_pool (id, source_id, published_at, stored_at, payload) VALUES (?, 'hh', '', '', ?)`,
    )
    .run(id, JSON.stringify({ description: '', fullDescription: options.text ?? TEXT }));
  database
    .prepare(
      `INSERT INTO vacancy_pool_index (id, source_id, is_active, url, search_text, expired)
       VALUES (?, 'hh', 1, 'https://hh.ru/vacancy/1', '', ?)`,
    )
    .run(id, options.expired ? 1 : 0);
}

function fakeClient(content = ANSWER) {
  const calls: BulkLlmInput[] = [];
  return {
    calls,
    complete: vi.fn(async (input: BulkLlmInput) => {
      calls.push(input);
      return {
        content,
        model: 'deepseek/deepseek-v4-flash',
        provider: 'deepinfra',
        usage: { cost: 0.0004, promptTokens: 900, cachedTokens: 0, completionTokens: 300 },
      };
    }),
  };
}

const noSpend = { task: () => ({ usd: 0, calls: 0 }), channelDay: () => 0, channelMonth: () => 0 };

function job(client: ReturnType<typeof fakeClient>, now = NOW, spend = noSpend) {
  return new CatalogRuSummaryJob({ store, client, spend, limits, now: () => now });
}

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec(MIGRATION_23 + VACANCY_POOL_INDEX_TABLE + VACANCY_CATALOG_ENTRIES_TABLE);
  store = new CatalogRuSummaryStore(database);
  store.ensureTable();
});
afterEach(() => database.close());

describe('catalog Russian summary job', () => {
  it('writes the newest card first, one model call a tick, and the page reads it by the text hash', async () => {
    addCard('old', { publishedMs: NOW - 3 * DAY });
    addCard('new', { publishedMs: NOW - DAY });
    const client = fakeClient();

    const report = await job(client).step();

    expect(report).toMatchObject({
      written: 1,
      model: 'deepseek/deepseek-v4-flash',
      costUsd: 0.0004,
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({
      task: 'catalog-ru-summary',
      dataClass: 'public',
      runId: 'catalog-ru-summary:2026-11-03',
    });
    const hash = catalogSummarySourceHash('Бухгалтер', TEXT);
    expect(store.readReady('cluster-new', hash, CATALOG_RU_SUMMARY_VERSION)?.facts.role).toBe(
      'Бухгалтер',
    );
    expect(store.readReady('cluster-old', hash, CATALOG_RU_SUMMARY_VERSION)).toBeUndefined();
    expect(
      store.readReady('cluster-new', 'other-hash', CATALOG_RU_SUMMARY_VERSION),
    ).toBeUndefined();

    await job(client).step();
    expect(store.countReady(CATALOG_RU_SUMMARY_VERSION)).toBe(2);
  });

  it('re-reads an unchanged card without a call and regenerates a rewritten one', async () => {
    addCard('card', { publishedMs: NOW - DAY });
    const client = fakeClient();
    await job(client).step();
    const later = NOW + SUMMARY_RECHECK_MS + 1;

    expect(await job(client, later).step()).toMatchObject({ unchanged: 1, written: 0 });
    expect(client.calls).toHaveLength(1);

    const rewritten = `${TEXT} Добавлено: работа с отчётностью.`;
    database
      .prepare('UPDATE vacancy_pool SET payload = ? WHERE id = ?')
      .run(JSON.stringify({ fullDescription: rewritten }), 'card');
    expect(await job(client, later + SUMMARY_RECHECK_MS + 1).step()).toMatchObject({ written: 1 });
    expect(client.calls).toHaveLength(2);
    expect(
      store.readReady(
        'cluster-card',
        catalogSummarySourceHash('Бухгалтер', rewritten),
        CATALOG_RU_SUMMARY_VERSION,
      ),
    ).toBeDefined();
  });

  it('skips cards without salary and marks a short text thin without a call', async () => {
    addCard('nosalary', { publishedMs: NOW, salary: null });
    addCard('short', { publishedMs: NOW - DAY, text: 'Бухгалтер в офис.' });
    const client = fakeClient();

    expect(await job(client).step()).toEqual({ thin: 1, written: 0, failed: 0, unchanged: 0 });
    expect(await job(client).step()).toMatchObject({ skipped: 'idle' });
    expect(client.calls).toHaveLength(0);
  });

  it('reads only a live pool row, as the page does, and treats an expired one as no text', async () => {
    addCard('expired', { publishedMs: NOW - DAY, expired: true });
    const client = fakeClient();
    expect(await job(client).step()).toMatchObject({ thin: 1, written: 0 });
    expect(client.calls).toHaveLength(0);
  });

  it('waits out a provider outage without spending the card attempts', async () => {
    addCard('card', { publishedMs: NOW - DAY });
    const client = fakeClient();
    client.complete.mockRejectedValueOnce(new Error('bulk stage failed'));
    const outage = job(client);
    expect(await outage.step()).toMatchObject({
      skipped: 'paused',
      issue: 'model_unavailable',
      failed: 0,
    });
    expect(await outage.step()).toMatchObject({ skipped: 'paused' });
    expect(client.complete).toHaveBeenCalledTimes(1);
    expect(await job(client, NOW + 11 * 60_000).step()).toMatchObject({ written: 1 });
  });

  it('counts answers every stage got wrong as the card attempt, not as an outage', async () => {
    addCard('card', { publishedMs: NOW - DAY });
    addCard('next', { publishedMs: NOW - 2 * DAY });
    const client = fakeClient();
    client.complete.mockImplementationOnce(async (input: BulkLlmInput) => {
      input.accept?.('{"summary":"One English sentence. Another one."}');
      throw new Error('Bulk answer rejected (z-ai/glm-5.3-flash)');
    });
    const step = job(client);
    expect(await step.step()).toMatchObject({ failed: 1, issue: 'not_russian' });
    expect(await step.step()).toMatchObject({ written: 1 });
  });

  it('records an answer with an invented number as failed and retries it later', async () => {
    addCard('card', { publishedMs: NOW - DAY });
    const invented = JSON.parse(ANSWER) as { summary: string };
    const client = fakeClient(
      JSON.stringify({ ...invented, summary: `${invented.summary} Премия 300 000 рублей.` }),
    );

    expect(await job(client).step()).toMatchObject({ failed: 1, issue: 'invented_number' });
    expect(await job(client, NOW + 60_000).step()).toMatchObject({ skipped: 'idle' });
    expect(store.countReady(CATALOG_RU_SUMMARY_VERSION)).toBe(0);
  });

  it('stops at its own cap and before the channel runs out, and pauses on a budget refusal', async () => {
    addCard('card', { publishedMs: NOW - DAY });
    const client = fakeClient();
    expect(
      await job(client, NOW, { ...noSpend, task: () => ({ usd: 1, calls: 3 }) }).step(),
    ).toMatchObject({ skipped: 'own_cap' });
    expect(await job(client, NOW, { ...noSpend, channelDay: () => 15 }).step()).toMatchObject({
      skipped: 'channel_headroom',
    });
    expect(await job(client, NOW, { ...noSpend, channelMonth: () => 80 }).step()).toMatchObject({
      skipped: 'channel_headroom',
    });
    expect(client.calls).toHaveLength(0);

    const refusing = fakeClient();
    refusing.complete.mockRejectedValueOnce(new Error(BULK_BUDGET_EXCEEDED));
    const paused = job(refusing);
    expect(await paused.step()).toMatchObject({ skipped: 'paused' });
    expect(await paused.step()).toMatchObject({ skipped: 'paused' });
    expect(refusing.complete).toHaveBeenCalledTimes(1);
  });

  it('reads spend from the bulk ledger table, and zero before it exists', () => {
    const spend = sqliteCatalogRuSummarySpend(database);
    expect(spend.task('2026-11-03')).toEqual({ usd: 0, calls: 0 });
    database.exec(
      'CREATE TABLE bulk_llm_spend(id TEXT PRIMARY KEY, run_id TEXT, task TEXT, day TEXT, reserved REAL, cost REAL, provider TEXT)',
    );
    database.exec(`INSERT INTO bulk_llm_spend VALUES
      ('1','r','catalog-ru-summary','2026-11-03',0.01,0.0005,'openrouter'),
      ('2','r','vacancy-fit','2026-11-03',0.01,NULL,'openrouter'),
      ('3','r','vacancy-fit','2026-11-01',0.01,2,'openrouter'),
      ('4','r','catalog-ru-summary','2026-11-03',3,3,'gemini'),
      ('5','r','vacancy-fit','2026-11-03',3,3,'gemini')`);
    // Vertex money (provider gemini) is counted by the Vertex gate, not by the 0.5 dollar cap of
    // OpenRouter nor by the channel's day and month caps; its calls still count towards the pace.
    expect(spend.task('2026-11-03')).toEqual({ usd: 0.0005, calls: 2 });
    expect(spend.channelDay('2026-11-03')).toBeCloseTo(0.0105);
    expect(spend.channelMonth('2026-11-01')).toBeCloseTo(2.0105);
  });
});
