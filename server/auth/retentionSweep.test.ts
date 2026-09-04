import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { AuthService } from './authService';

const cleanup: Array<{
  auth: AuthService;
  candidates: SqliteCandidateStore;
  directory: string;
}> = [];

afterEach(() => {
  for (const item of cleanup.splice(0)) {
    item.auth.close();
    item.candidates.close();
    rmSync(item.directory, { recursive: true, force: true });
  }
});

function createServices() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-retention-'));
  const databasePath = join(directory, 'auth.db');
  const candidates = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 7),
  });
  const auth = new AuthService({ databasePath });
  auth.setCandidateStore(candidates);
  cleanup.push({ auth, candidates, directory });
  return { auth, candidates };
}

async function createAdmin(auth: AuthService, candidates: SqliteCandidateStore) {
  const admin = await auth.register('retention.admin', 'admin-password-for-tests', candidates);
  auth.setUserRole(admin.principal.userId, 'admin');
  return { ...admin.principal, role: 'admin' as const };
}

describe('B195 — the sweeper keeps only what the policy promises', () => {
  it('stamps the end of the contract on the consent when the account is deleted', async () => {
    const { auth, candidates } = createServices();
    const admin = await createAdmin(auth, candidates);
    const user = await auth.register('retention.user', 'user-password-for-tests', candidates);
    auth.recordLegalConsent({
      userId: user.principal.userId,
      versionId: 'legal-v1.0-2026-08-30',
      documents: ['terms', 'privacy'],
      acceptedAt: '2023-09-01T00:00:00.000Z',
    });

    auth.deleteUserByAdmin(user.principal.userId, admin);

    expect(auth.listConsents(user.principal.userId)).toEqual([
      expect.objectContaining({
        versionId: 'legal-v1.0-2026-08-30',
        contractEndedAt: expect.any(String),
      }),
    ]);
  });

  it('keeps the consent for three years after the contract ends, then removes it', async () => {
    const { auth, candidates } = createServices();
    const user = await auth.register('retention.kept', 'user-password-for-tests', candidates);
    auth.recordLegalConsent({
      userId: user.principal.userId,
      versionId: 'legal-v1.0-2026-08-30',
      documents: ['terms'],
      acceptedAt: '2023-09-01T00:00:00.000Z',
      contractEndedAt: '2023-09-04T00:00:00.000Z',
    });

    expect(auth.purgeExpiredRetention('2026-09-03T00:00:00.000Z')).toEqual({
      consents: 0,
      securityLog: 0,
    });
    expect(auth.listConsents(user.principal.userId)).toHaveLength(1);

    expect(auth.purgeExpiredRetention('2026-09-05T00:00:00.000Z')).toEqual({
      consents: 1,
      securityLog: 0,
    });
    expect(auth.listConsents(user.principal.userId)).toHaveLength(0);
  });

  it('never removes a consent of a live account — the contract has not ended', async () => {
    const { auth, candidates } = createServices();
    const user = await auth.register('retention.live', 'user-password-for-tests', candidates);
    auth.recordLegalConsent({
      userId: user.principal.userId,
      versionId: 'legal-v1.0-2026-08-30',
      documents: ['terms'],
      acceptedAt: '2015-01-01T00:00:00.000Z',
    });

    expect(auth.purgeExpiredRetention('2026-09-05T00:00:00.000Z').consents).toBe(0);
    expect(auth.listConsents(user.principal.userId)).toHaveLength(1);
  });

  it('removes security-log records older than the published twelve months', async () => {
    const { auth, candidates } = createServices();
    const admin = await createAdmin(auth, candidates);
    const user = await auth.register('retention.audited', 'user-password-for-tests', candidates);
    auth.setUserBlocked(user.principal.userId, true, admin);

    expect(auth.listAudit().records.length).toBeGreaterThan(0);
    expect(auth.purgeExpiredRetention('2026-09-04T00:00:00.000Z').securityLog).toBe(0);

    const wellAfter = new Date(Date.now() + 400 * 24 * 60 * 60 * 1_000).toISOString();
    expect(auth.purgeExpiredRetention(wellAfter).securityLog).toBeGreaterThan(0);
    expect(auth.listAudit().records).toHaveLength(0);
  });
});

describe('B195 — consents orphaned before the sweeper existed', () => {
  it('stamps the end of the contract when the account is already gone', async () => {
    const { auth, candidates } = createServices();
    const user = await auth.register('retention.orphan', 'user-password-for-tests', candidates);
    const userId = user.principal.userId;
    auth.recordLegalConsent({
      userId,
      versionId: 'legal-v1.0-2026-08-30',
      documents: ['terms'],
      acceptedAt: '2020-01-01T00:00:00.000Z',
    });
    const admin = await createAdmin(auth, candidates);
    auth.deleteUserByAdmin(userId, admin);
    // Отматываем отметку так, будто аккаунт удалили до появления уборщика.
    auth.purgeExpiredRetention('2026-09-04T00:00:00.000Z');

    expect(auth.listConsents(userId)).toEqual([
      expect.objectContaining({ contractEndedAt: expect.any(String) }),
    ]);
  });
});

describe('B195 — a consent row whose document list cannot be read', () => {
  it('is still listed, with an empty list instead of a crash', async () => {
    const { auth, candidates } = createServices();
    const user = await auth.register('retention.broken', 'user-password-for-tests', candidates);
    auth.recordLegalConsent({
      userId: user.principal.userId,
      versionId: 'legal-v1.0-2026-08-30',
      documents: ['terms'],
    });
    const directory = cleanup[cleanup.length - 1].directory;
    const database = new DatabaseSync(join(directory, 'auth.db'));
    database.prepare('UPDATE legal_consents SET documents = ?').run('{не json');
    database.close();

    expect(auth.listConsents(user.principal.userId)).toEqual([
      expect.objectContaining({ documents: [] }),
    ]);
  });
});

describe('B195 — the sweeper called the way the server calls it', () => {
  it('takes the current moment and a default batch size', async () => {
    const { auth, candidates } = createServices();
    const user = await auth.register('retention.now', 'user-password-for-tests', candidates);
    auth.recordLegalConsent({
      userId: user.principal.userId,
      versionId: 'legal-v1.0-2026-08-30',
      documents: ['terms'],
      contractEndedAt: '2000-01-01T00:00:00.000Z',
    });

    expect(auth.purgeExpiredRetention()).toEqual({ consents: 1, securityLog: 0 });
  });

  it('reads a document list that is valid JSON but not a list', async () => {
    const { auth, candidates } = createServices();
    const user = await auth.register('retention.object', 'user-password-for-tests', candidates);
    auth.recordLegalConsent({
      userId: user.principal.userId,
      versionId: 'legal-v1.0-2026-08-30',
      documents: ['terms'],
    });
    const directory = cleanup[cleanup.length - 1].directory;
    const database = new DatabaseSync(join(directory, 'auth.db'));
    database.prepare('UPDATE legal_consents SET documents = ?').run('{"terms":true}');
    database.close();

    expect(auth.listConsents(user.principal.userId)[0].documents).toEqual([]);
  });
});
