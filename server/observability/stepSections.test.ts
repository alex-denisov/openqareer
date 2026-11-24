import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncSection } from './syncSections';
import { SealedText } from '../data/sealedText';
import { SqliteVacancyFitStore } from '../data/sqliteVacancyFitStore';
import { evaluateVacancyFit, type VacancyFitInput } from '../domain/vacancyFit';
import { MultiSourceVacancyEngine } from '../vacancies/multiSourceVacancyEngine';
import { runStepsYielding } from '../vacancies/yieldingSteps';
import type { VacancyPoolStore } from '../vacancies/vacancyPoolStore';
import { summarizeContextSteps } from '../routes/roleSkillAssessmentRoutes';

vi.mock('./syncSections', async (original) => {
  const actual = await original<typeof import('./syncSections')>();
  return { ...actual, syncSection: vi.fn(actual.syncSection) };
});

const named = () => vi.mocked(syncSection).mock.calls.map(([name]) => name);

function fitInput(vacancyId: string): VacancyFitInput {
  return {
    candidateId: 'candidate-a',
    vacancyId,
    description: 'TypeScript',
    requirements: [],
    facts: [],
    checkedFactIds: [],
    gates: {
      role: { status: 'matched', reason: 'verified' },
      level: { status: 'matched', reason: 'verified' },
      region: { status: 'matched', reason: 'verified' },
      workAuthorization: { status: 'matched', reason: 'verified' },
      workFormat: { status: 'matched', reason: 'verified' },
    },
    assessments: [],
  };
}

describe('B770a: синхронные куски шагов фона названы в журнале задержки', () => {
  afterEach(() => vi.mocked(syncSection).mockClear());

  it('list:fit-ids — каждая пачка прогрева под своим именем', async () => {
    const database = new DatabaseSync(':memory:');
    const store = new SqliteVacancyFitStore(database, new SealedText(Buffer.alloc(32, 7)));
    for (let index = 0; index < 7; index += 1) {
      const row = fitInput(`vacancy-${index}`);
      store.putCache(row, evaluateVacancyFit(row), '2026-11-23T00:00:00.000Z');
    }
    await store.warmCachedVacancyIds('candidate-a', {
      batch: 3,
      yieldToLoop: async () => undefined,
    });
    expect(named().filter((name) => name === 'fit-ids:batch')).toHaveLength(3);
    database.close();
  });

  it('role-snapshot и precompute:snapshot — кластеризация и сортировка подборки', async () => {
    const pool = {
      loadSourceStates: () => [],
      queryMatchCandidatesAsync: async () => [],
    } as unknown as VacancyPoolStore;
    const engine = new MultiSourceVacancyEngine({ sources: [], pool });
    await engine.getMatchedVacanciesAsync({ candidateId: 'candidate-a' } as never);
    expect(named()).toEqual(expect.arrayContaining(['engine:cluster', 'engine:sort']));
  });

  it('role-assessment-context — сводка роли', async () => {
    await runStepsYielding(summarizeContextSteps('Engineering Manager', 1, []), {
      section: 'assessment:summary',
    });
    expect(named()).toContain('assessment:summary');
  });
});
