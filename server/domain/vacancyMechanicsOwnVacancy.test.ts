import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SealedText } from '../data/sealedText';
import type { BulkLlmClient, BulkLlmInput } from '../providers/bulkLlmClient';
import { VacancyMechanicsRuntime } from './vacancyMechanicsRuntime';
import type { VacancyFitInput } from './vacancyFit';
import { extractVacancyRequirements } from './vacancyRequirements';

const DESCRIPTION = 'Requirements\n- UNIQUE_OWN_REQUIREMENT TypeScript\n- Node services';
const unknownGate = { status: 'unknown' as const, reason: 'unknown' };

function ownInput(directory: string): { runtime: VacancyMechanicsRuntime; input: VacancyFitInput } {
  const runtime = new VacancyMechanicsRuntime(join(directory, 'db.sqlite'), Buffer.alloc(32, 8), () => true);
  const vacancyId = 'own-00000000-0000-4000-8000-000000000001';
  const { requirements } = extractVacancyRequirements({ vacancyId, description: DESCRIPTION });
  return { runtime, input: {
    candidateId: 'candidate-own', vacancyId, description: DESCRIPTION, requirements, checkedFactIds: [],
    facts: [{ id: 'fact', candidateId: 'candidate-own', kind: 'fact', status: 'confirmed', sensitive: false, sourceMessageIds: [], statement: 'TypeScript services' }],
    gates: { role: unknownGate, level: unknownGate, region: unknownGate, workFormat: unknownGate, workAuthorization: unknownGate },
  } };
}

describe('B676: своя вакансия в расчёте совпадения', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const close of cleanup.splice(0)) close(); });

  it('воркер берёт требования из запечатанной задачи и не ставит текст в очередь требований', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'oq-own-fit-'));
    const { runtime, input } = ownInput(directory);
    cleanup.push(() => { runtime.close(); rmSync(directory, { recursive: true, force: true }); });
    const tasks: string[] = [];
    const client = { complete: async (request: BulkLlmInput) => {
      tasks.push(request.task);
      return { content: '{"assessments":[]}' };
    } } as unknown as BulkLlmClient;
    runtime.fit.enqueue(input);
    await runtime.runNext(client);
    expect(tasks).not.toContain('vacancy-requirements');
    expect(runtime.fit.getJobStatus(input)?.state).toBe('completed');
    expect(runtime.fit.getCache(input)?.vacancyId).toBe(input.vacancyId);
    const jobs = runtime.database.prepare('SELECT COUNT(*) AS n FROM vacancy_requirements_jobs').get() as { n: number };
    const cached = runtime.database.prepare('SELECT COUNT(*) AS n FROM vacancy_requirements_cache').get() as { n: number };
    expect([Number(jobs.n), Number(cached.n)]).toEqual([0, 0]);
    runtime.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    expect(readFileSync(join(directory, 'db.sqlite')).toString('latin1')).not.toContain('UNIQUE_OWN_REQUIREMENT');
  });

  it('удаление своей вакансии убирает её задачи и результаты под любым ключом, чужие не трогает', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'oq-own-forget-'));
    const { runtime, input } = ownInput(directory);
    cleanup.push(() => { runtime.close(); rmSync(directory, { recursive: true, force: true }); });
    const other = { ...input, vacancyId: 'own-00000000-0000-4000-8000-000000000002' };
    const older = { ...input, profileContextHash: 'older-profile' };
    runtime.fit.enqueue(input);
    runtime.fit.enqueue(older);
    runtime.fit.enqueue(other);
    await runtime.runNext(null);
    expect(runtime.fit.forgetVacancy(input.candidateId, input.vacancyId)).toBeGreaterThanOrEqual(2);
    expect(runtime.fit.getJobStatus(input)).toBeUndefined();
    expect(runtime.fit.getJobStatus(older)).toBeUndefined();
    expect(runtime.fit.getCache(input)).toBeUndefined();
    expect(runtime.fit.getJobStatus(other)).toBeDefined();
  });

  it('удаление убирает и завершённые задачи, у которых запечатанный вход уже стёрт', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'oq-own-forget-done-'));
    const { runtime, input } = ownInput(directory);
    cleanup.push(() => { runtime.close(); rmSync(directory, { recursive: true, force: true }); });
    const older = { ...input, profileContextHash: 'older-profile' };
    runtime.fit.enqueue(input);
    runtime.fit.enqueue(older);
    await runtime.runNext(null);
    await runtime.runNext(null);
    expect(runtime.fit.getJobStatus(input)?.state).toBe('completed');
    expect(runtime.fit.getJobStatus(older)?.state).toBe('completed');
    runtime.fit.forgetVacancy(input.candidateId, input.vacancyId);
    expect(runtime.fit.getJobStatus(input)).toBeUndefined();
    expect(runtime.fit.getJobStatus(older)).toBeUndefined();
  });

  it('удаление на кандидате с 5 000 строк подборки не вскрывает их и укладывается в 300 мс', () => {
    const directory = mkdtempSync(join(tmpdir(), 'oq-own-forget-volume-'));
    const { runtime, input } = ownInput(directory);
    cleanup.push(() => { vi.restoreAllMocks(); runtime.close(); rmSync(directory, { recursive: true, force: true }); });
    const bulky = `${DESCRIPTION}\n${'x'.repeat(20_000)}`;
    runtime.database.exec('BEGIN');
    for (let index = 0; index < 5_000; index += 1) {
      const pool = { ...input, vacancyId: `pool-${index}`, description: bulky };
      runtime.fit.enqueue(pool);
    }
    runtime.database.exec('COMMIT');
    runtime.fit.enqueue(input);
    const opened = vi.spyOn(SealedText.prototype, 'open');
    const started = performance.now();
    expect(runtime.fit.forgetVacancy(input.candidateId, input.vacancyId)).toBe(1);
    expect(performance.now() - started).toBeLessThan(300);
    expect(opened).not.toHaveBeenCalled();
    expect(runtime.fit.getJobStatus(input)).toBeUndefined();
    expect(runtime.fit.getJobStatus({ ...input, vacancyId: 'pool-7', description: bulky })).toBeDefined();
  });
});
