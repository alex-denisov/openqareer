import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BulkLlmClient, BulkLlmInput } from '../providers/bulkLlmClient';
import { VacancyMechanicsRuntime } from './vacancyMechanicsRuntime';
import type { VacancyFitInput } from './vacancyFit';
import type { VacancyRequirement } from './vacancyRequirements';

function input(): VacancyFitInput {
  const candidateId = 'candidate-a';
  const gate = { status: 'unknown', reason: 'unknown' } as const;
  return {
    candidateId, vacancyId: 'vacancy', description: 'Requirements\n- TypeScript required\n- Node services\n- SQL queries\n- Kafka streams', requirements: [],
    facts: [{ id: 'fact', candidateId, kind: 'fact', status: 'confirmed', sensitive: false, sourceMessageIds: ['m'], statement: 'TypeScript services with SQL' }],
    gates: { role: gate, level: gate, region: gate, workFormat: gate, workAuthorization: gate },
  };
}

/** The labelled lines of the text for a requirements call, one quoted claim per line for a fit call. */
function model(): { readonly client: BulkLlmClient; readonly fitCalls: () => number } {
  let fits = 0;
  const complete = async (request: BulkLlmInput) => {
    if (request.task === 'vacancy-requirements') {
      const lines = request.input.split('\n').map((line) => line.replace(/^-\s*/u, '').trim()).filter((line) => line && !/^requirements$/iu.test(line));
      return { content: JSON.stringify({ requirements: lines.map((line) => ({ text: line, sourceQuote: line, origin: 'structural', label: line, kind: 'skill' })) }) };
    }
    fits += 1;
    const { requirements } = JSON.parse(request.input) as { requirements: { id: string }[] };
    return { content: JSON.stringify({ assessments: requirements.map(({ id }) => ({ requirementId: id, status: 'partial', evidence: [{ factId: 'fact', quote: 'TypeScript' }] })) }) };
  };
  return { client: { complete } as unknown as BulkLlmClient, fitCalls: () => fits };
}

interface StoredRequirements { requirements: VacancyRequirement[] }

describe('a finished fit job whose result is gone (04.11)', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const close of cleanup.splice(0)) close(); vi.useRealTimers(); });
  function setup() {
    const directory = mkdtempSync(join(tmpdir(), 'oq-fit-lost-'));
    const runtime = new VacancyMechanicsRuntime(join(directory, 'mechanics.sqlite'), Buffer.alloc(32, 8), () => true);
    cleanup.push(() => { runtime.close(); rmSync(directory, { recursive: true, force: true }); });
    return runtime;
  }
  /** The text stays and the extraction changes: what a re-read of the requirements does on prod. */
  function rewriteRequirements(runtime: VacancyMechanicsRuntime, change: (rows: VacancyRequirement[]) => VacancyRequirement[], at = Date.now()): void {
    const row = runtime.database.prepare('SELECT cache_key, result_json FROM vacancy_requirements_cache').get() as { cache_key: string; result_json: string };
    const stored = JSON.parse(row.result_json) as StoredRequirements;
    runtime.database.prepare('UPDATE vacancy_requirements_cache SET result_json=?, updated_at=? WHERE cache_key=?')
      .run(JSON.stringify({ ...stored, requirements: change(stored.requirements) }), at, row.cache_key);
  }
  async function counted(runtime: VacancyMechanicsRuntime, source: VacancyFitInput, client: BulkLlmClient): Promise<void> {
    runtime.enqueue(source);
    await runtime.runNext(client);
    expect(runtime.view(source).state).toBe('ready');
  }
  const withoutLast = (rows: VacancyRequirement[]) => rows.slice(0, -1);

  it('queue and result live under different keys: the job holds no requirements, the result does', async () => {
    const runtime = setup(); const source = input(); const { client } = model();
    await counted(runtime, source, client);
    const jobs = runtime.database.prepare('SELECT cache_key, status FROM vacancy_fit_queue').all() as { cache_key: string; status: string }[];
    const results = runtime.database.prepare('SELECT cache_key FROM vacancy_fit_cache').all() as { cache_key: string }[];
    expect(jobs.map((row) => row.status)).toEqual(['completed']);
    expect(results).toHaveLength(1);
    expect(results[0]!.cache_key).not.toBe(jobs[0]!.cache_key);
  });

  it('new requirements under the same text queue the row again, and the worker counts it', async () => {
    const runtime = setup(); const source = input(); const { client, fitCalls } = model();
    await counted(runtime, source, client);
    expect(fitCalls()).toBe(1);
    rewriteRequirements(runtime, withoutLast);
    expect(runtime.view(source).state).toBe('refreshing');

    expect(runtime.enqueue(source).status).toBe('pending');
    expect(runtime.view(source).state).toBe('refreshing');
    await runtime.runNext(client);
    expect(fitCalls()).toBe(2);
    expect(runtime.view(source).state).toBe('ready');
  });

  it('a row with no earlier percent leaves «считаем» too', async () => {
    const runtime = setup(); const source = input(); const { client } = model();
    await counted(runtime, source, client);
    rewriteRequirements(runtime, (rows) => rows.map((row) => ({ ...row, id: `${row.id}-new` })));
    expect(runtime.view(source).state).toBe('not_requested');
    runtime.enqueue(source);
    expect(runtime.view(source).state).toBe('processing');
    await runtime.runNext(client);
    expect(runtime.view(source).state).toBe('ready');
  });

  it('asks the model once per change: a counted row is never queued again', async () => {
    const runtime = setup(); const source = input(); const { client, fitCalls } = model();
    await counted(runtime, source, client);
    expect(runtime.enqueue(source).status).toBe('completed');
    rewriteRequirements(runtime, withoutLast);
    runtime.enqueue(source);
    await runtime.runNext(client);
    for (let read = 0; read < 3; read += 1) expect(runtime.enqueue(source).status).toBe('completed');
    await runtime.runNext(client);
    expect(fitCalls()).toBe(2);
  });

  it('requirements still being read leave the job alone: the worker would count the old ones', async () => {
    const runtime = setup(); const source = input(); const { client } = model();
    await counted(runtime, source, client);
    runtime.database.exec('DELETE FROM vacancy_requirements_cache');
    expect(runtime.enqueue(source).status).toBe('completed');
  });

  it('rows lost before the census wait for the owner: each one is a model call for a real candidate', async () => {
    const runtime = setup(); const source = input(); const { client } = model();
    await counted(runtime, source, client);
    rewriteRequirements(runtime, withoutLast, Date.parse('2026-11-03T00:00:00.000Z'));
    expect(runtime.enqueue(source).status).toBe('completed');
    expect(runtime.view(source).state).toBe('refreshing');
  });

  it('the background sweep spends the day\'s slot; with none left the row waits', async () => {
    const runtime = setup(); const source = input(); const { client } = model();
    await counted(runtime, source, client);
    rewriteRequirements(runtime, withoutLast);
    const closed = vi.fn(() => false);
    expect(runtime.enqueue(source, { backgroundRank: 0, reviveSlot: closed }).status).toBe('completed');
    expect(closed).toHaveBeenCalledTimes(1);
    const open = vi.fn(() => true);
    expect(runtime.enqueue(source, { backgroundRank: 0, reviveSlot: open }).status).toBe('pending');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a job that lost its result holds no key, so the sweep reaches it; one lost before the census still holds', async () => {
    const runtime = setup(); const source = input(); const { client } = model();
    await counted(runtime, source, client);
    expect(runtime.fitJobHoldsKey(source)).toBe(true);
    rewriteRequirements(runtime, withoutLast);
    expect(runtime.fitJobHoldsKey(source)).toBe(false);
    rewriteRequirements(runtime, (rows) => rows, Date.parse('2026-11-03T00:00:00.000Z'));
    expect(runtime.fitJobHoldsKey(source)).toBe(true);
  });

  it('a counted row spends no slot', async () => {
    const runtime = setup(); const source = input(); const { client } = model();
    await counted(runtime, source, client);
    const slot = vi.fn(() => true);
    runtime.enqueue(source, { backgroundRank: 0, reviveSlot: slot });
    expect(slot).not.toHaveBeenCalled();
  });

  it('a result under the current requirements is shown when the missing verdict is for a line the text does not hold', async () => {
    const runtime = setup(); const source = input(); const { client, fitCalls } = model();
    const unsourced = { id: 'no-source', text: 'Kubernetes', sourceQuote: 'not in this text', origin: 'structural', importance: 'medium', kind: 'other', hard: false, stopFactor: false } as VacancyRequirement;
    await counted(runtime, source, client);
    rewriteRequirements(runtime, (rows) => [...rows, unsourced]);
    runtime.enqueue(source);
    await runtime.runNext(client);
    expect(fitCalls()).toBe(2);
    // The model is asked about lines of the text only, so no result ever holds a verdict for this one.
    const view = runtime.view(source);
    expect(view.result?.assessments.map((item) => item.requirementId)).not.toContain('no-source');
    expect(view.state).toBe('ready');
    expect(view.result?.coveragePercent).toBeGreaterThan(0);
    runtime.enqueue(source);
    await runtime.runNext(client);
    expect(fitCalls()).toBe(2);
  });

  it('a result with no verdict for a line the text does hold stays hidden (02.11)', async () => {
    const runtime = setup(); const source = input(); const { client } = model();
    await counted(runtime, source, client);
    const before = runtime.view(source).result;
    expect(before?.coveragePercent).toBeGreaterThan(0);
    rewriteRequirements(runtime, (rows) => rows.map((row, index) => (index === 0 ? { ...row, id: `${row.id}-reworded` } : row)));
    expect(runtime.view(source).state).toBe('not_requested');
    expect(runtime.view(source).result).toBeUndefined();
  });
});
