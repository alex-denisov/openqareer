import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteCandidateCompanyWantsRepository } from './sqliteCandidateCompanyWantsRepository';

describe('candidate company wants repository (B439)', () => {
  const resources: Array<{ database: DatabaseSync; repository: SqliteCandidateCompanyWantsRepository }> = [];

  afterEach(() => {
    for (const resource of resources.splice(0)) {
      resource.repository.close();
      resource.database.close();
    }
  });

  it('upserts wants idempotently and retains a saved next step', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY); INSERT INTO candidates VALUES (\'candidate-a\');');
    const repository = new SqliteCandidateCompanyWantsRepository(
      database,
      Buffer.alloc(32, 13),
    );
    resources.push({ database, repository });

    repository.setWanted('candidate-a', 'company-vb', 'Вектор Банк',  '2026-10-08T10:00:00.000Z');
    repository.setNextStep('candidate-a', 'company-vb', 'Написать Марии Орловой', '2026-10-10');
    repository.setWanted('candidate-a', 'company-vb', 'Вектор Банк', '2026-10-09T10:00:00.000Z');

    expect(repository.list('candidate-a')).toEqual([
      expect.objectContaining({
        companyKey: 'company-vb',
        companyName: 'Вектор Банк',
        nextStep: 'Написать Марии Орловой',
        nextStepDueAt: '2026-10-10',
      }),
    ]);
    const stored = database
      .prepare('SELECT next_step_cipher FROM candidate_company_wants')
      .get() as { next_step_cipher: string };
    expect(stored.next_step_cipher).not.toContain('Написать Марии Орловой');
  });

  it('removes wants idempotently and scopes them to the candidate', () => {
    const database = new DatabaseSync(':memory:');
    database.exec("CREATE TABLE candidates (id TEXT PRIMARY KEY); INSERT INTO candidates VALUES ('candidate-a'), ('candidate-b');");
    const repository = new SqliteCandidateCompanyWantsRepository(
      database,
      Buffer.alloc(32, 14),
    );
    resources.push({ database, repository });
    repository.setWanted('candidate-a', 'company-vb', 'Вектор Банк');

    expect(repository.list('candidate-b')).toEqual([]);
    expect(repository.remove('candidate-a', 'company-vb')).toBe(true);
    expect(repository.remove('candidate-a', 'company-vb')).toBe(false);
    expect(repository.list('candidate-a')).toEqual([]);
  });
});
