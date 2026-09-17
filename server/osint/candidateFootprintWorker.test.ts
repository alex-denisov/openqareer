import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SqliteCandidateReputationRepository } from '../data/sqliteCandidateReputationRepository';
import { runCandidateFootprintAudit } from './candidateFootprintWorker';
import type { CandidateStore } from '../data/candidateStore';

describe('candidateFootprintWorker', () => {
  function createTestEnv() {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateReputationRepository(db);
    return { repo };
  }

  it('выполняет аудит и сохраняет результат в репозиторий', async () => {
    const { repo } = createTestEnv();
    const candidateId = 'cand-worker-1';

    const audit = await runCandidateFootprintAudit({
      candidateId,
      repo,
      options: {
        experience: [
          {
            id: 'e1',
            company: 'Ozon',
            role: 'Senior Product Manager',
            startDate: '2021-01',
            endDate: '2023-05',
          },
        ],
        externalProfiles: [
          {
            platform: 'hh.ru',
            company: 'Ozon',
            role: 'Senior Product Manager',
            startDate: '2021-01',
            endDate: '2023-05',
          },
        ],
        publicPosts: [],
      },
    });

    expect(audit.candidateId).toBe(candidateId);
    expect(audit.status).toBe('completed');
    expect(audit.overallStatus).toBe('safe');
    expect(audit.score).toBe(100);

    const saved = repo.getLatestAudit(candidateId);
    expect(saved).not.toBeNull();
    expect(saved?.id).toBe(audit.id);
    expect(saved?.score).toBe(100);
  });

  it('извлекает опыт из candidateStore если он передан и нет явного experience', async () => {
    const { repo } = createTestEnv();
    const candidateId = 'cand-worker-store';

    const mockStore = {
      getSnapshot: () => ({
        candidate: { id: candidateId, dataClass: 'synthetic', locale: 'ru-RU', createdAt: '' },
        importedSources: [],
        messages: [],
        memory: [],
        turns: [],
        dossier: { skills: [], milestones: [], summary: '' },
        assessments: [],
        germanyMarket: null,
        resume: {
          draft: {
            basics: {},
            experience: [
              {

                id: 'exp-store-1',
                chronologyMemoryId: 'm1',
                employer: 'Avito',
                title: 'Team Lead',
                startDate: '2020-01',
                endDate: '2022-01',
                current: false,
                bulletMemoryIds: [],
              },
            ],
            skills: [],
            educations: [],
            courses: [],
            tests: [],
            certificates: [],
          },
          evidenceSnapshot: [],
          createdAt: '',
          updatedAt: '',
        },
        documents: [],
        vacancySubscriptions: [],
      }),
    } as unknown as CandidateStore;

    const audit = await runCandidateFootprintAudit({
      candidateId,
      repo,
      candidateStore: mockStore,
      options: {
        externalProfiles: [
          {
            platform: 'hh.ru',
            company: 'Avito',
            role: 'Team Lead',
            startDate: '2020-01',
            endDate: '2022-01',
          },
        ],
      },
    });

    expect(audit.status).toBe('completed');
    expect(audit.consistencyDiscrepancies).toHaveLength(0);
    const saved = repo.getLatestAudit(candidateId);
    expect(saved).not.toBeNull();
  });
});
