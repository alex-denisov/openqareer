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

  describe('recordEvent', () => {
    it('appends a follow-up event without changing the stage', () => {
      const { repo } = createRepo();
      const created = repo.create('candidate-1', { clusterId: 'cluster-1', stage: 'applied', vacancy });
      const after = repo.recordEvent('candidate-1', created.id, {
        kind: 'follow_up_sent',
        occurredAt: '2030-01-01T00:00:00.000Z',
      });
      expect(after.stage).toBe('applied');
      const events = repo.listEvents('candidate-1', created.id);
      expect(events.at(-1)).toMatchObject({ kind: 'follow_up_sent', provenance: 'candidate' });
    });

    it('throws not-found for an unknown application', () => {
      const { repo } = createRepo();
      expect(() =>
        repo.recordEvent('candidate-1', 'missing', {
          kind: 'thank_you_sent',
          occurredAt: '2026-09-10T00:00:00.000Z',
        }),
      ).toThrow(ApplicationNotFoundError);
    });
  });

  describe('archiveClosedVacancy', () => {
    it('archives a card with a system event and vacancy_closed reason', () => {
      const { repo } = createRepo();
      const created = repo.create('candidate-1', { clusterId: 'cluster-1', stage: 'applied', vacancy });
      const archived = repo.archiveClosedVacancy('candidate-1', created);
      expect(archived.stage).toBe('archived');
      expect(archived.closedReason).toBe('vacancy_closed');
      const events = repo.listEvents('candidate-1', created.id);
      expect(events.at(-1)).toMatchObject({ toStage: 'archived', provenance: 'system' });
    });

    it('is idempotent: does not touch an already-archived or rejected card', () => {
      const { repo } = createRepo();
      const created = repo.create('candidate-1', { clusterId: 'cluster-1', stage: 'rejected', vacancy });
      const untouched = repo.archiveClosedVacancy('candidate-1', created);
      expect(untouched).toEqual(created);
      expect(repo.listEvents('candidate-1', created.id)).toHaveLength(1);
    });
  });

  describe('countSystemClosuresSince', () => {
    it('counts vacancies the system archived after the given time (B251, S4, /today digest)', () => {
      const { repo } = createRepo();
      const created = repo.create('candidate-1', { clusterId: 'cluster-1', stage: 'applied', vacancy });
      expect(repo.countSystemClosuresSince('candidate-1', '2026-09-24T00:00:00.000Z')).toBe(0);
      repo.archiveClosedVacancy('candidate-1', created, '2026-09-24T10:00:00.000Z');
      expect(repo.countSystemClosuresSince('candidate-1', '2026-09-24T00:00:00.000Z')).toBe(1);
      expect(repo.countSystemClosuresSince('candidate-1', '2026-09-24T11:00:00.000Z')).toBe(0);
    });

    it('does not count a card the candidate archived themselves', () => {
      const { repo } = createRepo();
      const created = repo.create('candidate-1', { clusterId: 'cluster-1', stage: 'applied', vacancy });
      repo.patch('candidate-1', created.id, { expectedVersion: created.version, stage: 'rejected' });
      expect(repo.countSystemClosuresSince('candidate-1', '2020-01-01T00:00:00.000Z')).toBe(0);
    });
  });

  describe('funnel', () => {
    it('counts distinct applications that ever reached each stage', () => {
      const { repo } = createRepo();
      const a = repo.create('candidate-1', { clusterId: 'cluster-1', stage: 'saved', vacancy });
      repo.patch('candidate-1', a.id, { expectedVersion: a.version, stage: 'applied' });
      repo.create('candidate-1', { clusterId: 'cluster-2', stage: 'saved', vacancy });
      const funnel = repo.funnel('candidate-1');
      expect(funnel.saved).toBe(2);
      expect(funnel.applied).toBe(1);
      expect(funnel.interview).toBe(0);
    });
  });

  describe('create with a manual card', () => {
    it('stores a companyHidden manual vacancy with no clusterId', () => {
      const { repo } = createRepo();
      const created = repo.create('candidate-1', {
        stage: 'saved',
        vacancy: { title: 'Через рекрутера', company: '', url: '', source: 'recruiter', companyHidden: true },
      });
      expect(created.clusterId).toBeNull();
      expect(created.vacancy).toMatchObject({ companyHidden: true, source: 'recruiter' });
    });
  });
});
