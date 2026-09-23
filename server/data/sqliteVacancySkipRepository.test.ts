import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_33 } from './sqliteSchema';
import { SealedText } from './sealedText';
import { SqliteApplicationRepository } from './sqliteApplicationRepository';
import { SqliteVacancySkipRepository } from './sqliteVacancySkipRepository';

const vacancy = { title: 'Продуктовый аналитик', company: 'FinCloud', url: 'https://example.test/1', source: 'src' };

function createRepos() {
  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  database.exec(MIGRATION_33);
  database.prepare("INSERT INTO candidates (id) VALUES ('candidate-1')").run();
  const applications = new SqliteApplicationRepository(database, new SealedText(randomBytes(32)));
  const skips = new SqliteVacancySkipRepository(database);
  return { applications, skips };
}

describe('SqliteVacancySkipRepository', () => {
  it('records a skip and archives the saved card for that cluster, in one transaction', () => {
    const { applications, skips } = createRepos();
    const created = applications.create('candidate-1', { clusterId: 'cluster-1', stage: 'saved', vacancy });
    skips.create(
      'candidate-1',
      { clusterId: 'cluster-1', reasonId: 'geo-format', origin: 'vacancy_card' },
      (candidateId, clusterId, reasonId) =>
        applications.archiveSavedByCluster(candidateId, clusterId, reasonId),
    );
    expect(skips.list('candidate-1')).toHaveLength(1);
    const archived = applications.get('candidate-1', created.id);
    expect(archived?.stage).toBe('archived');
    expect(archived?.closedReason).toBe('geo-format');
  });

  it('does not touch a card that already moved past saved', () => {
    const { applications, skips } = createRepos();
    const created = applications.create('candidate-1', { clusterId: 'cluster-1', stage: 'interview', vacancy });
    skips.create(
      'candidate-1',
      { clusterId: 'cluster-1', reasonId: 'company', origin: 'vacancy_card' },
      (candidateId, clusterId, reasonId) =>
        applications.archiveSavedByCluster(candidateId, clusterId, reasonId),
    );
    const untouched = applications.get('candidate-1', created.id);
    expect(untouched?.stage).toBe('interview');
  });

  it('deletes a skip', () => {
    const { skips } = createRepos();
    skips.create(
      'candidate-1',
      { clusterId: 'cluster-2', reasonId: 'duplicate', origin: 'kanban' },
      () => undefined,
    );
    expect(skips.delete('candidate-1', 'cluster-2')).toBe(true);
    expect(skips.list('candidate-1')).toHaveLength(0);
    expect(skips.delete('candidate-1', 'cluster-2')).toBe(false);
  });
});
