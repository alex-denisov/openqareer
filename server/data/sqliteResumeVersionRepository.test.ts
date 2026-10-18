import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildResumeStudioProjection, buildTargetedResumeSlice } from '../domain/resumeStudio';
import { estimateResumePages } from '../domain/resumeTargetedVolume';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import type { ResumeVersionContent } from '../domain/resumeVersions';
import { RESUME_VERSION_MIGRATION } from './resumeVersionSchema';
import { SealedText } from './sealedText';
import { SqliteResumeVersionRepository } from './sqliteResumeVersionRepository';

const databases: DatabaseSync[] = [];

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
});

function createRepository(candidateIds: readonly string[]) {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec('PRAGMA foreign_keys = ON; CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  const insertCandidate = database.prepare('INSERT INTO candidates (id) VALUES (?)');
  for (const candidateId of candidateIds) insertCandidate.run(candidateId);
  database.exec(RESUME_VERSION_MIGRATION);
  const repository = new SqliteResumeVersionRepository(
    database,
    new SealedText(Buffer.alloc(32, 9)),
  );
  return { database, repository };
}

function targetedSnapshot() {
  const projection = buildResumeStudioProjection({
    ...EMPTY_RESUME_DRAFT,
    evidence: [],
  });
  return estimateResumePages(
    buildTargetedResumeSlice(projection.master, {
      title: 'Secret Platform Engineer',
      requirements: ['SecretKubernetes'],
    }),
  );
}

function content(status: ResumeVersionContent['status'] = 'draft'): ResumeVersionContent {
  return {
    title: 'Secret Platform Engineer',
    requirements: ['SecretKubernetes'],
    status,
    snapshot: targetedSnapshot(),
  };
}

describe('SqliteResumeVersionRepository', () => {
  it('seals all candidate text and scopes get/list by candidate id', () => {
    const { database, repository } = createRepository(['candidate-a', 'candidate-b']);
    const created = repository.create(
      'candidate-a',
      'version-1',
      'master-revision-a',
      content(),
    );

    expect(created.status).toBe('created');
    if (created.status !== 'created') throw new Error('version should be created');
    expect(created.version.revision).toBe(1);
    expect(repository.get('candidate-b', 'version-1')).toBeNull();
    const otherPage = repository.list('candidate-b', { limit: 20, cursor: null });
    const candidatePage = repository.list('candidate-a', { limit: 20, cursor: null });
    expect(otherPage.items).toEqual([]);
    expect(otherPage.totalCount).toBe(0);
    expect(candidatePage.items).toHaveLength(1);
    expect(candidatePage.totalCount).toBe(1);

    const stored = database
      .prepare(
        'SELECT content_cipher FROM candidate_resume_versions WHERE candidate_id = ? AND version_id = ?',
      )
      .get('candidate-a', 'version-1') as { content_cipher: string };
    expect(stored.content_cipher).not.toContain('Secret Platform Engineer');
    expect(stored.content_cipher).not.toContain('SecretKubernetes');
  });

  it('uses integer revision and master baseline checks for edits', () => {
    const { repository } = createRepository(['candidate-a']);
    repository.create('candidate-a', 'version-1', 'master-revision-a', content());

    const updated = repository.update(
      'candidate-a',
      'version-1',
      1,
      'master-revision-a',
      { ...content(), title: 'Updated Platform Engineer' },
    );
    expect(updated.status).toBe('updated');
    if (updated.status !== 'updated') throw new Error('version should be updated');
    expect(updated.version.revision).toBe(2);
    expect(updated.version.title).toBe('Updated Platform Engineer');

    expect(
      repository.update(
        'candidate-a',
        'version-1',
        1,
        'master-revision-a',
        content(),
      ).status,
    ).toBe('revision_conflict');
    expect(
      repository.update(
        'candidate-a',
        'version-1',
        2,
        'master-revision-b',
        content(),
      ).status,
    ).toBe('source_conflict');
  });

  it('creates drafts, approves unchanged snapshots, and resets edits to draft', () => {
    const { repository } = createRepository(['candidate-a']);
    expect(() =>
      repository.create('candidate-a', 'preapproved-version', 'master-revision-a', content('approved')),
    ).toThrow('new resume versions must start as drafts');
    expect(() =>
      repository.create('candidate-a', 'sent-version', 'master-revision-a', content('sent')),
    ).toThrow('new resume versions must start as drafts');

    repository.create('candidate-a', 'version-1', 'master-revision-a', content());

    const changedApproval = repository.update(
      'candidate-a',
      'version-1',
      1,
      'master-revision-a',
      { ...content('approved'), title: 'Changed after review' },
    );
    expect(changedApproval.status).toBe('immutable');
    expect(repository.get('candidate-a', 'version-1')?.status).toBe('draft');

    const approved = repository.update(
      'candidate-a',
      'version-1',
      1,
      'master-revision-a',
      content('approved'),
    );
    expect(approved.status).toBe('updated');
    if (approved.status !== 'updated') throw new Error('unchanged draft should be approved');
    expect(approved.version.status).toBe('approved');
    expect(approved.version.revision).toBe(2);

    const edited = repository.update(
      'candidate-a',
      'version-1',
      2,
      'master-revision-a',
      { ...content(), title: 'Edited after approval' },
    );
    expect(edited.status).toBe('updated');
    if (edited.status !== 'updated') throw new Error('approved version should return to draft');
    expect(edited.version.status).toBe('draft');
    expect(edited.version.title).toBe('Edited after approval');
    expect(edited.version.revision).toBe(3);
  });

  it('cascades sealed versions when the owning candidate is deleted', () => {
    const { database, repository } = createRepository(['candidate-a']);
    repository.create('candidate-a', 'version-1', 'master-revision-a', content());

    database.prepare('DELETE FROM candidates WHERE id = ?').run('candidate-a');
    const remaining = database
      .prepare('SELECT COUNT(*) AS count FROM candidate_resume_versions WHERE candidate_id = ?')
      .get('candidate-a') as { readonly count: number };

    expect(Number(remaining.count)).toBe(0);
    expect(repository.get('candidate-a', 'version-1')).toBeNull();
  });

  it('treats a retry with the same candidate-scoped version id as idempotent', () => {
    const { repository } = createRepository(['candidate-a']);
    repository.create('candidate-a', 'version-1', 'master-revision-a', content());

    const retried = repository.create(
      'candidate-a',
      'version-1',
      'master-revision-a',
      content(),
    );

    expect(retried.status).toBe('replayed');
    if (retried.status !== 'replayed') throw new Error('same request should replay');
    expect(retried.version.revision).toBe(1);
  });
});
