import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BulkLlmClient, BulkLlmInput } from '../providers/bulkLlmClient';
import { VacancyMechanicsRuntime } from './vacancyMechanicsRuntime';
import { evaluateVacancyFit, type VacancyFitInput } from './vacancyFit';

function input(candidateId = 'candidate-secret-owner'): VacancyFitInput {
  return {
    candidateId, vacancyId: 'vacancy-public', description: 'Requirements\n- TypeScript required', requirements: [],
    facts: [{ id: 'private-fact', candidateId, kind: 'fact', status: 'confirmed', sensitive: false, sourceMessageIds: ['private-message'], statement: 'PRIVATE_OWNER_STATEMENT TypeScript services' }],
    gates: {
      role: { status: 'unknown', reason: 'role not confirmed' }, level: { status: 'unknown', reason: 'level unknown' },
      region: { status: 'unknown', reason: 'region unknown' }, workFormat: { status: 'unknown', reason: 'format unknown' }, workAuthorization: { status: 'unknown', reason: 'authorization unknown' },
    },
  };
}

describe('background vacancy mechanics with real SQLite', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const close of cleanup.splice(0)) close(); });
  function setup(validate: ((source: VacancyFitInput) => boolean) | null = () => true) {
    const directory = mkdtempSync(join(tmpdir(), 'oq-mechanics-qa-'));
    const path = join(directory, 'mechanics.sqlite');
    // Synthetic fixtures explicitly stand in for an authoritative profile reader.
    const runtime = new VacancyMechanicsRuntime(path, Buffer.alloc(32, 8), validate ?? undefined);
    cleanup.push(() => { runtime.close(); rmSync(directory, { recursive: true, force: true }); });
    return runtime;
  }

  it('enqueues idempotently, extracts in worker and caches an honest unavailable result without a model instead of a fabricated percentage', async () => {
    const runtime = setup(); const source = input();
    runtime.enqueue(source); runtime.enqueue(source);
    expect(runtime.view(source).state).toBe('processing');
    expect(await runtime.runNext(null)).toBe(true);
    const view = runtime.view(source);
    // Модель выключена: оценить требования нечем, повтор ничего не изменит — честный итог без числа.
    expect(view.state).toBe('ready');
    expect(view.requirements[0].sourceQuote).toBe('TypeScript required');
    expect(view.result).toMatchObject({ status: 'unknown', coveragePercent: null, reason: 'assessment_unavailable' });
    expect(await runtime.runNext(null)).toBe(false);
    runtime.enqueue(source);
    expect(await runtime.runNext(null)).toBe(false);
  });

  it('isolates candidate caches and invalidates after profile or description changes', async () => {
    const runtime = setup(); const source = input(); runtime.enqueue(source); await runtime.runNext(null);
    expect(runtime.view(input('another-candidate')).result).toBeUndefined();
    expect(runtime.view({ ...source, facts: [] }).result).toBeUndefined();
    expect(runtime.view({ ...source, description: 'Requirements\n- Rust required' }).result).toBeUndefined();
    const rows = runtime.database.prepare('SELECT * FROM vacancy_fit_cache').all();
    const queues = runtime.database.prepare('SELECT * FROM vacancy_fit_queue').all();
    const persisted = JSON.stringify([rows, queues]);
    expect(persisted).not.toContain(source.candidateId);
    expect(persisted).not.toContain('PRIVATE_OWNER_STATEMENT');
    expect(persisted).not.toContain('private-message');
  });

  it('deletion fences an already leased worker and removes candidate-derived rows', () => {
    const runtime = setup(); const source = input(); runtime.enqueue(source);
    const job = runtime.fit.claim()!;
    runtime.deleteCandidate(source.candidateId);
    expect(runtime.fit.complete(job, evaluateVacancyFit(source))).toBe(false);
    expect(runtime.view(source).result).toBeUndefined();
    expect(runtime.database.prepare('SELECT COUNT(*) AS n FROM vacancy_fit_queue').get()).toMatchObject({ n: 0 });
    expect(runtime.database.prepare('SELECT COUNT(*) AS n FROM vacancy_fit_cache').get()).toMatchObject({ n: 0 });
  });

  it.each([['', 'no_description'], ['We make useful tools.', 'no_requirements']] as const)('preserves source state after worker: %s', async (description, expected) => {
    const runtime = setup(); const source = { ...input(), description }; runtime.enqueue(source);
    if (!description) expect(runtime.view(source).state).toBe('no_description');
    await runtime.runNext(null);
    expect(runtime.view(source).state).toBe(expected);
    expect(runtime.view(source).result?.coveragePercent ?? null).toBeNull();
  });

  it('assesses only in the worker and caches sourced numeric coverage under candidate data class', async () => {
    const runtime = setup(); const original = input();
    const source: VacancyFitInput = { ...original, description: 'Requirements\n- TypeScript experience required', gates: {
      role: { status: 'matched', reason: 'confirmed' }, level: { status: 'matched', reason: 'confirmed' },
      region: { status: 'matched', reason: 'confirmed' }, workFormat: { status: 'matched', reason: 'confirmed' }, workAuthorization: { status: 'matched', reason: 'confirmed' },
    } };
    const complete = vi.fn(async (request: BulkLlmInput) => {
      const requirement = JSON.parse(request.input).requirements[0];
      return { content: JSON.stringify({ assessments: [{ requirementId: requirement.id, status: 'matched', evidence: [{ factId: 'private-fact', quote: 'TypeScript services' }] }] }) };
    });
    const client = { complete } as unknown as BulkLlmClient;
    runtime.enqueue(source);
    expect(complete).not.toHaveBeenCalled();
    await runtime.runNext(client);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0]).toMatchObject({ task: 'vacancy-fit', dataClass: 'candidate' });
    expect(runtime.view(source).result).toMatchObject({ coveragePercent: 100, status: 'assessed', requiredCoverage: { matched: 1, total: 1, percent: 100 } });
    runtime.enqueue(source);
    expect(await runtime.runNext(client)).toBe(false);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('does not busy-loop fit jobs while requirement extraction is backed off', async () => {
    const runtime = setup(); const source = { ...input(), description: 'We make useful tools.' }; runtime.enqueue(source);
    const complete = vi.fn().mockRejectedValue(new Error('provider_offline'));
    const client = { complete } as unknown as BulkLlmClient;
    await runtime.runNext(client);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await runtime.runNext(client)).toBe(false);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(runtime.view(source).result).toBeUndefined();
  });

  it('does not freeze a transient assessment failure into a ready cached unknown', async () => {
    const runtime = setup(); const original = input();
    const source: VacancyFitInput = { ...original, gates: {
      role: { status: 'matched', reason: 'confirmed' }, level: { status: 'matched', reason: 'confirmed' },
      region: { status: 'matched', reason: 'confirmed' }, workFormat: { status: 'matched', reason: 'confirmed' }, workAuthorization: { status: 'matched', reason: 'confirmed' },
    } };
    const complete = vi.fn().mockRejectedValue(new Error('provider_timeout'));
    runtime.enqueue(source);
    await runtime.runNext({ complete } as unknown as BulkLlmClient);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(runtime.view(source).result).toBeUndefined();
    expect(runtime.view(source).state).not.toBe('ready');
  });

  it('can cache a valid all-unknown assessment without inventing zero percent or a provider error', async () => {
    const runtime = setup(); const original = input();
    const source: VacancyFitInput = { ...original, gates: {
      role: { status: 'matched', reason: 'confirmed' }, level: { status: 'matched', reason: 'confirmed' },
      region: { status: 'matched', reason: 'confirmed' }, workFormat: { status: 'matched', reason: 'confirmed' }, workAuthorization: { status: 'matched', reason: 'confirmed' },
    } };
    const complete = vi.fn(async (request: BulkLlmInput) => ({ content: JSON.stringify({ assessments: [{ requirementId: JSON.parse(request.input).requirements[0].id, status: 'unknown', evidence: [] }] }) }));
    runtime.enqueue(source);
    await runtime.runNext({ complete } as unknown as BulkLlmClient);
    expect(runtime.view(source)).toMatchObject({ state: 'ready', result: { status: 'unknown', coveragePercent: null } });
    expect(await runtime.runNext({ complete } as unknown as BulkLlmClient)).toBe(false);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('fails closed without an authoritative profile validator before candidate outbound calls', async () => {
    const runtime = setup(null); const original = input();
    const source: VacancyFitInput = { ...original, gates: {
      role: { status: 'matched', reason: 'confirmed' }, level: { status: 'matched', reason: 'confirmed' },
      region: { status: 'matched', reason: 'confirmed' }, workFormat: { status: 'matched', reason: 'confirmed' }, workAuthorization: { status: 'matched', reason: 'confirmed' },
    } };
    const complete = vi.fn().mockRejectedValue(new Error('candidate data must not leave'));
    runtime.enqueue(source);
    await runtime.runNext({ complete } as unknown as BulkLlmClient);
    expect(complete).not.toHaveBeenCalled();
    expect(runtime.view(source).state).toBe('failed');
  });

  it('bounds automatic retries and lets an explicit request retry a failed job after recovery', async () => {
    const runtime = setup(); const original = input();
    const source: VacancyFitInput = { ...original, gates: {
      role: { status: 'matched', reason: 'confirmed' }, level: { status: 'matched', reason: 'confirmed' },
      region: { status: 'matched', reason: 'confirmed' }, workFormat: { status: 'matched', reason: 'confirmed' }, workAuthorization: { status: 'matched', reason: 'confirmed' },
    } };
    const complete = vi.fn().mockRejectedValue(new Error('provider_timeout'));
    const client = { complete } as unknown as BulkLlmClient;
    vi.useFakeTimers({ toFake: ['Date'] });
    cleanup.push(() => vi.useRealTimers());
    vi.setSystemTime(Date.parse('2026-10-21T04:00:00.000Z'));
    runtime.enqueue(source);
    await runtime.runNext(client);
    expect(runtime.view(source).state).toBe('retrying');
    expect(await runtime.runNext(client)).toBe(false);
    expect(complete).toHaveBeenCalledTimes(1);
    for (let attempt = 1; attempt < 3; attempt += 1) {
      vi.setSystemTime(Date.now() + 10 * 60_000);
      await runtime.runNext(client);
    }
    expect(complete).toHaveBeenCalledTimes(3);
    expect(runtime.takeStats()).toMatchObject({ claimed: 3, retried: 2, failed: 1, completed: 0, lastError: 'assessment_model_unavailable' });
    expect(runtime.view(source).state).toBe('failed');
    expect(await runtime.runNext(client)).toBe(false);
    expect(complete).toHaveBeenCalledTimes(3);
    const requirementId = runtime.view(source).requirements[0].id;
    complete.mockResolvedValue({ content: JSON.stringify({ assessments: [{ requirementId, status: 'unknown', evidence: [] }] }) });
    runtime.enqueue(source);
    expect(runtime.view(source).state).toBe('processing');
    await runtime.runNext(client);
    expect(complete).toHaveBeenCalledTimes(4);
    expect(runtime.view(source)).toMatchObject({ state: 'ready', result: { coveragePercent: null, status: 'unknown' } });
    expect(await runtime.runNext(client)).toBe(false);
  });

  it('extracts requirements from a fenced model answer and counts the call for the journal (B522)', async () => {
    const runtime = setup(); const source = { ...input(), description: 'We build payments. 10+ years of Java.' };
    const quote = '10+ years of Java';
    const complete = vi.fn(async (request: BulkLlmInput) => request.task === 'vacancy-requirements'
      ? { content: '```json\n' + JSON.stringify({ requirements: [{ text: quote, sourceQuote: quote, origin: 'job listing' }] }) + '\n```', model: 'deepseek/deepseek-v4-flash', provider: 'StreamLake', usage: { cost: 0, promptTokens: 1, cachedTokens: 0, completionTokens: 1 } }
      : Promise.reject(new Error('provider_offline')));
    runtime.enqueue(source);
    await runtime.runNext({ complete } as unknown as BulkLlmClient);
    expect(runtime.requirements.getLatest(source.vacancyId)?.requirements[0]).toMatchObject({ text: quote, origin: 'structural' });
    expect(runtime.takeStats()).toMatchObject({ requirementsDone: 1, requirementsInvalid: 0, llmCalls: 2, llmFailed: 1, lastModel: 'deepseek/deepseek-v4-flash', providers: ['StreamLake'] });
  });

  it('spends under one budget run per UTC day: the run changes at midnight and accumulates inside the day (B522)', async () => {
    const runtime = setup();
    const runIds: string[] = [];
    const complete = vi.fn(async (request: BulkLlmInput) => { runIds.push(request.runId); throw new Error('provider_offline'); });
    vi.useFakeTimers({ toFake: ['Date'] });
    cleanup.push(() => vi.useRealTimers());
    vi.setSystemTime(Date.parse('2026-10-21T23:59:00.000Z'));
    runtime.enqueue({ ...input(), vacancyId: 'a', description: 'We make useful tools.' });
    runtime.enqueue({ ...input(), vacancyId: 'b', description: 'We make other tools.' });
    await runtime.runNext({ complete } as unknown as BulkLlmClient);
    await runtime.runNext({ complete } as unknown as BulkLlmClient);
    vi.setSystemTime(Date.parse('2026-10-22T00:30:00.000Z'));
    await runtime.runNext({ complete } as unknown as BulkLlmClient);
    expect(runIds).toEqual(['vacancy-mechanics:2026-10-21', 'vacancy-mechanics:2026-10-21', 'vacancy-mechanics:2026-10-22']);
  });
});
