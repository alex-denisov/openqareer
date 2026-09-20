import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-auth-'));
  const databasePath = join(directory, 'auth.db');
  const candidates = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 5),
  });
  const auth = new AuthService({ databasePath });
  cleanup.push({ auth, candidates, directory });
  return { auth, candidates };
}

describe('role and session authentication', () => {
  it('registers an isolated personal candidate and rejects a duplicate username', async () => {
    const { auth, candidates } = createServices();
    const registered = await auth.register(
      'New.Candidate',
      'candidate-password-for-tests',
      candidates,
    );

    expect(registered.principal).toMatchObject({
      username: 'new.candidate',
      role: 'candidate',
      isTest: false,
      candidate: { dataClass: 'personal' },
    });
    expect(auth.authenticate(registered.sessionToken)?.candidate?.id).toBe(
      registered.principal.candidate?.id,
    );
    await expect(
      auth.register('NEW.CANDIDATE', 'another-password-for-tests', candidates),
    ).rejects.toThrow('username is already registered');
  });

  it('seeds explicit candidate/admin identities and verifies passwords', async () => {
    const { auth, candidates } = createServices();
    await auth.seedAccounts(
      [
        {
          username: 'Owner.Admin',
          password: 'admin-password-for-tests',
          role: 'admin',
        },
        {
          username: 'Candidate.Test',
          password: 'candidate-password-for-tests',
          role: 'candidate',
        },
      ],
      candidates,
    );

    expect(
      await auth.login('candidate.test', 'wrong-password'),
    ).toBeNull();
    const candidate = await auth.login(
      'CANDIDATE.TEST',
      'candidate-password-for-tests',
    );
    expect(candidate?.principal).toMatchObject({
      username: 'candidate.test',
      role: 'candidate',
      isTest: true,
      candidate: {
        dataClass: 'synthetic',
      },
    });
    const admin = await auth.login(
      'owner.admin',
      'admin-password-for-tests',
    );
    expect(admin?.principal).toMatchObject({
      username: 'owner.admin',
      role: 'admin',
      candidate: null,
    });

    expect(auth.authenticate(candidate!.sessionToken)).toMatchObject({
      role: 'candidate',
    });
    auth.logout(candidate!.sessionToken);
    expect(auth.authenticate(candidate!.sessionToken)).toBeNull();
  });

  it('reseeding resets the password without duplicating candidate identity', async () => {
    const { auth, candidates } = createServices();
    await auth.seedAccounts(
      [
        {
          username: 'candidate.test',
          password: 'candidate-password-one',
          role: 'candidate',
        },
      ],
      candidates,
    );
    const first = await auth.login(
      'candidate.test',
      'candidate-password-one',
    );

    await auth.seedAccounts(
      [
        {
          username: 'candidate.test',
          password: 'candidate-password-two',
          role: 'candidate',
        },
      ],
      candidates,
    );
    const second = await auth.login(
      'candidate.test',
      'candidate-password-two',
    );

    expect(
      await auth.login('candidate.test', 'candidate-password-one'),
    ).toBeNull();
    expect(second?.principal.candidate?.id).toBe(
      first?.principal.candidate?.id,
    );
  });
});

/**
 * PRB-038. Сессия жила ровно 12 часов с момента входа: кандидат работал в
 * приложении, а к вечеру профиль оставался на экране при `401` на каждом
 * кандидатском маршруте. Решение владельца (2026-09-20): сессия скользящая,
 * истекает только по 30 дням бездействия; привязки к IP нет.
 */
describe('sliding session expiry (PRB-038)', () => {
  const DAY = 24 * 60 * 60 * 1_000;

  afterEach(() => {
    vi.useRealTimers();
  });

  it('extends the session on every authenticated request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T10:00:00.000Z'));
    const { auth, candidates } = createServices();
    const { sessionToken } = await auth.register('sliding', 'candidate-password-for-tests', candidates);

    const issued = auth.getAccount(sessionToken)?.sessions.find((session) => session.current);
    expect(issued?.expiresAt).toBe('2026-10-20T10:00:00.000Z');

    vi.setSystemTime(new Date('2026-10-10T10:00:00.000Z'));
    expect(auth.authenticate(sessionToken)?.username).toBe('sliding');
    const extended = auth.getAccount(sessionToken)?.sessions.find((session) => session.current);
    expect(extended?.expiresAt).toBe('2026-11-09T10:00:00.000Z');
  });

  it('expires only after thirty idle days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T10:00:00.000Z'));
    const { auth, candidates } = createServices();
    const { sessionToken } = await auth.register('idle', 'candidate-password-for-tests', candidates);

    vi.setSystemTime(new Date(Date.now() + 29 * DAY));
    expect(auth.authenticate(sessionToken)).not.toBeNull();

    vi.setSystemTime(new Date(Date.now() + 31 * DAY));
    expect(auth.authenticate(sessionToken)).toBeNull();
  });
});
