import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
});
