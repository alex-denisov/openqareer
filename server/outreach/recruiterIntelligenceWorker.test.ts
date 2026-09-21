import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SqliteRecruiterContactsRepository } from '../data/sqliteRecruiterContactsRepository';
import { runRecruiterIntelligenceJobs } from './recruiterIntelligenceWorker';

describe('recruiter intelligence worker', () => {
  it('processes a queued job outside the route and stores the result', async () => {
    const database = new DatabaseSync(':memory:');
    const repository = new SqliteRecruiterContactsRepository(database);
    repository.enqueueJob('candidate-a', 'vac-1');

    const result = await runRecruiterIntelligenceJobs({
      repository,
      resolveVacancy: () => ({
        id: 'vac-1',
        company: 'Acme Corp',
        title: 'Product Manager',
        url: 'https://careers.acme.example/jobs/1',
        description: 'Recruiter: Anna Petrova; email anna.petrova@acme.example',
      }),
    });

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0 });
    expect(repository.getJob('candidate-a', 'vac-1')).toMatchObject({ status: 'ready' });
    expect(repository.getContactsByVacancyId('candidate-a', 'vac-1')).toHaveLength(1);
    repository.close();
  });
});
