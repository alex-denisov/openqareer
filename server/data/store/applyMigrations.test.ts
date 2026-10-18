import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EMPTY_RESUME_DRAFT } from '../../domain/resumeDraft';
import { buildTargetedResumeSlice } from '../../domain/resumeStudio';
import type { ResumeDocument } from '../../domain/resumeStudioTypes';
import { estimateResumePages } from '../../domain/resumeTargetedVolume';
import { SealedText } from '../sealedText';
import { SqliteCandidateStore } from '../sqliteCandidateStore';
import { SqliteResumeRepository } from '../sqliteResumeRepository';
import { applyMigrations, MIGRATIONS } from './applyMigrations';

describe('applyMigrations', () => {
  it('upgrades the populated pre-change store and supports resume-version CRUD after reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-resume-version-migration-'));
    const databasePath = join(directory, 'candidate.db');
    const encryptionKey = Buffer.alloc(32, 17);
    const candidateId = randomUUID();
    const conversationId = randomUUID();
    const createdAt = '2026-10-16T09:00:00.000Z';
    let store: SqliteCandidateStore | null = null;
    const masterDocument: ResumeDocument = {
      kind: 'master',
      targetRole: 'Platform Engineer',
      contact: {
        fullName: 'Mila Example',
        email: 'mila@example.test',
        phone: null,
        location: 'Berlin',
        links: [],
      },
      about: null,
      experience: [],
      skills: [],
      education: [],
      projects: [],
      languages: [],
      unknowns: [],
      conventions: {
        country: null,
        packVersion: null,
        reverseChronological: true,
        maxPages: null,
        recommendedBulletsPerRole: null,
        photo: 'omitted',
        discriminatoryPii: 'omitted',
      },
      length: { lines: 0, pages: 1, linesPerPage: 45 },
    };

    const makeSnapshot = (title: string, requirements: readonly string[]) =>
      estimateResumePages(buildTargetedResumeSlice(masterDocument, { title, requirements }));

    try {
      const oldDatabase = new DatabaseSync(databasePath, {
        enableForeignKeyConstraints: true,
      });
      try {
        applyMigrations(oldDatabase, (operation) => operation(), MIGRATIONS.slice(0, -2));
        const appliedBeforeUpgrade = oldDatabase
          .prepare('SELECT version FROM schema_migrations ORDER BY version')
          .all() as { readonly version: number }[];
        expect(appliedBeforeUpgrade.map((row) => row.version)).toHaveLength(40);
        expect(
          oldDatabase
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'candidate_resume_versions'",
            )
            .get(),
        ).toBeUndefined();
        expect(
          oldDatabase
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profile_revision_experience_links'",
            )
            .get(),
        ).toBeUndefined();

        oldDatabase
          .prepare(
            'INSERT INTO candidates (id, token_hash, data_class, locale, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(candidateId, 'legacy-token-hash', 'synthetic', 'ru-RU', createdAt, createdAt);
        oldDatabase
          .prepare(
            'INSERT INTO conversations (id, candidate_id, created_at, updated_at) VALUES (?, ?, ?, ?)',
          )
          .run(conversationId, candidateId, createdAt, createdAt);
        new SqliteResumeRepository(oldDatabase, new SealedText(encryptionKey)).save(
          candidateId,
          { ...EMPTY_RESUME_DRAFT, targetRole: 'Platform Engineer' },
          [],
        );
      } finally {
        oldDatabase.close();
      }

      const upgradedDatabase = new DatabaseSync(databasePath, {
        enableForeignKeyConstraints: true,
      });
      try {
        applyMigrations(upgradedDatabase, (operation) => operation());
        expect(
          upgradedDatabase
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'candidate_resume_versions'",
            )
            .get(),
        ).toBeDefined();
        expect(
          upgradedDatabase
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profile_revision_experience_links'",
            )
            .get(),
        ).toBeDefined();
        const latestVersion = upgradedDatabase
          .prepare('SELECT MAX(version) AS version FROM schema_migrations')
          .get() as { readonly version: number };
        expect(latestVersion.version).toBe(MIGRATIONS.length);
      } finally {
        upgradedDatabase.close();
      }

      store = new SqliteCandidateStore({ databasePath, encryptionKey });
      expect(store.getSnapshot(candidateId).resume?.draft.targetRole).toBe('Platform Engineer');

      const sourceMasterRevision = 'opaque-master-revision';
      const versionId = randomUUID();
      const created = store.createResumeVersion(candidateId, versionId, sourceMasterRevision, {
        title: 'Platform Engineer',
        requirements: ['Kubernetes'],
        status: 'draft',
        snapshot: makeSnapshot('Platform Engineer', ['Kubernetes']),
      });
      expect(created.status).toBe('created');
      if (created.status !== 'created') throw new Error('version should be created');

      const updated = store.updateResumeVersion(
        candidateId,
        versionId,
        1,
        sourceMasterRevision,
        {
          title: 'Platform Engineer II',
          requirements: ['Kubernetes', 'Terraform'],
          status: 'draft',
          snapshot: makeSnapshot('Platform Engineer II', ['Kubernetes', 'Terraform']),
        },
      );
      expect(updated.status).toBe('updated');
      store.close();
      store = null;

      const reopened = new SqliteCandidateStore({ databasePath, encryptionKey });
      try {
        expect(reopened.getSnapshot(candidateId).resume?.draft.targetRole).toBe(
          'Platform Engineer',
        );
        expect(reopened.getResumeVersion(candidateId, versionId)).toMatchObject({
          title: 'Platform Engineer II',
          requirements: ['Kubernetes', 'Terraform'],
          revision: 2,
          sourceMasterRevision,
        });
        expect(reopened.listResumeVersions(candidateId, { limit: 20, cursor: null })).toMatchObject({
          totalCount: 1,
        });
      } finally {
        reopened.close();
      }
    } finally {
      store?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
