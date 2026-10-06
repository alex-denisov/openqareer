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

  it('keeps one active session per device and one more for a different device', async () => {
    const { auth, candidates } = createServices();
    const password = 'candidate-password-for-tests';
    const sameDevice = '00000000-0000-4000-8000-000000000001';
    const otherDevice = '00000000-0000-4000-8000-000000000002';
    let current = await auth.register('device.sessions', password, candidates, {}, sameDevice);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      current = (await auth.login('device.sessions', password, sameDevice))!;
    }

    expect(auth.getAccount(current.sessionToken)?.sessions).toHaveLength(1);
    const other = await auth.login('device.sessions', password, otherDevice);
    expect(auth.getAccount(other!.sessionToken)?.sessions).toHaveLength(2);
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

  it('does not include an expired device session beside a current device session', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T10:00:00.000Z'));
    const { auth, candidates } = createServices();
    const oldDevice = await auth.register(
      'expired.device',
      'candidate-password-for-tests',
      candidates,
      {},
      '00000000-0000-4000-8000-000000000011',
    );

    vi.setSystemTime(new Date(Date.now() + 29 * DAY));
    const currentDevice = await auth.login(
      'expired.device',
      'candidate-password-for-tests',
      '00000000-0000-4000-8000-000000000012',
    );
    vi.setSystemTime(new Date(Date.now() + 2 * DAY));

    expect(auth.getAccount(currentDevice!.sessionToken)?.sessions).toHaveLength(1);
    expect(auth.authenticate(oldDevice.sessionToken)).toBeNull();
  });

  it('removes a logged-out device from the active device count', async () => {
    const { auth, candidates } = createServices();
    const firstDevice = await auth.register(
      'logout.device',
      'candidate-password-for-tests',
      candidates,
      {},
      '00000000-0000-4000-8000-000000000021',
    );
    const currentDevice = await auth.login(
      'logout.device',
      'candidate-password-for-tests',
      '00000000-0000-4000-8000-000000000022',
    );

    auth.logout(firstDevice.sessionToken);

    expect(auth.getAccount(currentDevice!.sessionToken)?.sessions).toHaveLength(1);
  });
});

describe('canonical email anti-abuse and duplicate detection (B347 / US-11.5)', () => {
  it('detects duplicate registration across email aliases (plus-tags, dots, domain synonyms)', async () => {
    const { auth, candidates } = createServices();
    await auth.register('first.user', 'valid-password-1', candidates, {
      email: 'fixture@gmail.com',
    });

    // Trying to register with plus tag on googlemail.com with dots
    await expect(
      auth.register('second.user', 'valid-password-2', candidates, {
        email: 'f.i.x.t.u.r.e+alias@googlemail.com',
      }),
    ).rejects.toThrow('email is already registered');
  });

  it('rejects registration with disposable email domain', async () => {
    const { auth, candidates } = createServices();
    await expect(
      auth.register('burner.user', 'valid-password-3', candidates, {
        email: 'bot@tempmail.com',
      }),
    ).rejects.toThrow(/Временные и одноразовые/);
  });
});
