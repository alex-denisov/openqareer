import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_33 } from './sqliteSchema';
import { SealedText } from './sealedText';
import { SqliteApplicationRepository } from './sqliteApplicationRepository';
import { ApplicationNotFoundError, ApplicationVersionConflictError } from './store/errors';

const vacancy = {
  title: 'Продуктовый аналитик',
  company: 'FinCloud',
  url: 'https://example.test/jobs/1',
  source: 'src-remotive',
};

function createRepo(): { repo: SqliteApplicationRepository; database: DatabaseSync } {
  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  database.exec(MIGRATION_33);
  database.prepare("INSERT INTO candidates (id) VALUES ('candidate-1')").run();
  const repo = new SqliteApplicationRepository(database, new SealedText(randomBytes(32)));
  return { repo, database };
}

describe('SqliteApplicationRepository', () => {
  it('creates a card and records a stage event with candidate provenance', () => {
    const { repo } = createRepo();
    const created = repo.create('candidate-1', { clusterId: 'cluster-1', stage: 'saved', vacancy });
    expect(created.stage).toBe('saved');
    expect(created.version).toBe(1);
    expect(created.vacancy).toEqual(vacancy);

    const events = repo.listEvents('candidate-1', created.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'stage', fromStage: null, toStage: 'saved', provenance: 'candidate' });
  });

  it('does not create a duplicate for a repeated clusterId', () => {
    const { repo } = createRepo();
    const first = repo.create('candidate-1', { clusterId: 'cluster-1', stage: 'saved', vacancy });
    const second = repo.create('candidate-1', { clusterId: 'cluster-1', stage: 'saved', vacancy });
    expect(second.id).toBe(first.id);
    expect(repo.list('candidate-1')).toHaveLength(1);
  });

  it('patches stage and bumps version, recording an event', () => {
    const { repo } = createRepo();
    const created = repo.create('candidate-1', { clusterId: 'cluster-1', stage: 'saved', vacancy });
    const patched = repo.patch('candidate-1', created.id, {
      expectedVersion: created.version,
      stage: 'applied',
    });
    expect(patched.stage).toBe('applied');
    expect(patched.version).toBe(2);
    const events = repo.listEvents('candidate-1', created.id);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ fromStage: 'saved', toStage: 'applied', provenance: 'candidate' });
  });

  it('allows manual transitions in any direction, including backwards', () => {
    const { repo } = createRepo();
    const created = repo.create('candidate-1', { clusterId: 'cluster-1', stage: 'interview' });
    const patched = repo.patch('candidate-1', created.id, {
      expectedVersion: created.version,
      stage: 'applied',
    });
    expect(patched.stage).toBe('applied');
  });

  it('rejects a stale expectedVersion with a conflict error', () => {
    const { repo } = createRepo();
    const created = repo.create('candidate-1', { clusterId: 'cluster-1', stage: 'saved' });
    repo.patch('candidate-1', created.id, { expectedVersion: created.version, stage: 'applied' });
    expect(() =>
      repo.patch('candidate-1', created.id, { expectedVersion: created.version, stage: 'responded' }),
    ).toThrow(ApplicationVersionConflictError);
  });

  it('throws not-found for an unknown application id', () => {
    const { repo } = createRepo();
    expect(() => repo.patch('candidate-1', 'missing', { expectedVersion: 1 })).toThrow(
      ApplicationNotFoundError,
    );
  });

  describe('recordLegacyApplied', () => {
    it('creates a card at applied when none exists', () => {
      const { repo } = createRepo();
      repo.recordLegacyApplied('candidate-1', 'cluster-1', vacancy);
      const [application] = repo.list('candidate-1');
      expect(application.stage).toBe('applied');
      expect(repo.listEvents('candidate-1', application.id)[0]).toMatchObject({
        provenance: 'legacy_client',
      });
    });

    it('upgrades a saved card to applied', () => {
      const { repo } = createRepo();
      repo.create('candidate-1', { clusterId: 'cluster-1', stage: 'saved', vacancy });
      repo.recordLegacyApplied('candidate-1', 'cluster-1', vacancy);
      const [application] = repo.list('candidate-1');
      expect(application.stage).toBe('applied');
    });

    it('never downgrades a card that moved past applied', () => {
      const { repo } = createRepo();
      const created = repo.create('candidate-1', { clusterId: 'cluster-1', stage: 'interview', vacancy });
      repo.recordLegacyApplied('candidate-1', 'cluster-1', vacancy);
      const application = repo.get('candidate-1', created.id);
      expect(application?.stage).toBe('interview');
      // Only the manual creation event exists; the legacy click wrote nothing.
      expect(repo.listEvents('candidate-1', created.id)).toHaveLength(1);
    });
  });

  describe('migrateLegacyApplied', () => {
    it('is idempotent: a second run creates no duplicates', () => {
      const { repo } = createRepo();
      const legacy = [{ clusterId: 'cluster-1', vacancy, appliedAt: '2026-09-01T00:00:00.000Z' }];
      repo.migrateLegacyApplied('candidate-1', legacy);
      repo.migrateLegacyApplied('candidate-1', legacy);
      expect(repo.list('candidate-1')).toHaveLength(1);
      expect(repo.listEvents('candidate-1', repo.list('candidate-1')[0].id)[0]).toMatchObject({
        provenance: 'migrated',
      });
    });

    it('does not overwrite a card the candidate already created manually', () => {
      const { repo } = createRepo();
      const created = repo.create('candidate-1', { clusterId: 'cluster-1', stage: 'interview', vacancy });
      repo.migrateLegacyApplied('candidate-1', [
        { clusterId: 'cluster-1', vacancy, appliedAt: '2026-09-01T00:00:00.000Z' },
      ]);
      const application = repo.get('candidate-1', created.id);
      expect(application?.stage).toBe('interview');
      expect(repo.list('candidate-1')).toHaveLength(1);
    });
  });
});
