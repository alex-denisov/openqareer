import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LinkedinPoolConflictError,
  SqliteLinkedinPoolRepository,
  type LinkedinSessionProbe,
} from './sqliteLinkedinPoolRepository';
import { isLinkedinSessionCookieDomain, type LinkedinSessionCookie } from './sessionContract';

const actor = { actorUserId: 'admin-user', actorUsername: 'admin.test' };
const encryptionKey = Buffer.alloc(32, 19);
const resources: Array<{ repository: SqliteLinkedinPoolRepository; directory: string }> = [];

afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.repository.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

function createRepository(probe?: LinkedinSessionProbe) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-linkedin-pool-'));
  const repository = new SqliteLinkedinPoolRepository({
    databasePath: join(directory, 'app.db'),
    encryptionKey,
    runtimeRoot: join(directory, 'runtime'),
    probe,
  });
  resources.push({ repository, directory });
  return { repository, directory };
}

function createAccount(repository: SqliteLinkedinPoolRepository) {
  return repository.create({
    adminLabel: 'Основной пул',
    emailLogin: 'pool-admin@example.test',
    providerAccountMarker: 'marker-1',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    ...actor,
  }).account;
}

function sessionCookies(
  expiresAt = Math.floor((Date.now() + 60 * 60_000) / 1_000),
): LinkedinSessionCookie[] {
  return [
    {
      name: 'li_at',
      value: 'synthetic-linkedin-session-secret',
      domain: '.linkedin.com',
      path: '/',
      expiresAt,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: 'liap',
      value: 'synthetic-linkedin-preference',
      domain: 'www.linkedin.com',
      path: '/',
      expiresAt: null,
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    },
  ];
}

async function markAccountReady(repository: SqliteLinkedinPoolRepository, accountId: string) {
  const login = await repository.beginLogin(accountId, actor);
  return repository.completeLogin(accountId, login.lease.handle, {
    state: 'ready',
    accountMarker: 'marker-1',
  });
}

describe('SqliteLinkedinPoolRepository', () => {
  it('filters cookie domains with label boundaries instead of substring matches', () => {
    expect(isLinkedinSessionCookieDomain('.linkedin.com')).toBe(true);
    expect(isLinkedinSessionCookieDomain('www.linkedin.com')).toBe(true);
    expect(isLinkedinSessionCookieDomain('login.linkedin.cn')).toBe(true);
    expect(isLinkedinSessionCookieDomain('notlinkedin.com')).toBe(false);
    expect(isLinkedinSessionCookieDomain('linkedin.com.example.test')).toBe(false);
  });

  it('stores the full admin identifier encrypted but returns it only from the repository admin view', () => {
    const { repository, directory } = createRepository();
    const account = createAccount(repository);

    expect(account.emailLogin).toBe('pool-admin@example.test');
    expect(repository.list({ limit: 25, offset: 0 }).accounts[0]?.emailLogin).toBe(
      'pool-admin@example.test',
    );
    const rawDatabase = readFileSync(join(directory, 'app.db')).toString('utf8');
    expect(rawDatabase).not.toContain('pool-admin@example.test');
  });

  it('is idempotent, durable and rejects duplicate email logins', () => {
    const { repository, directory } = createRepository();
    const first = createAccount(repository);
    const replay = repository.create({
      adminLabel: 'Основной пул',
      emailLogin: 'POOL-ADMIN@example.test',
      providerAccountMarker: 'marker-1',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      ...actor,
    });
    expect(replay.created).toBe(false);
    expect(replay.account.id).toBe(first.id);
    expect(() =>
      repository.create({
        adminLabel: 'Другой',
        emailLogin: 'pool-admin@example.test',
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
        ...actor,
      }),
    ).toThrow('linkedin_email_login_exists');

    resources.pop();
    repository.close();
    const reopened = new SqliteLinkedinPoolRepository({
      databasePath: join(directory, 'app.db'),
      encryptionKey,
      runtimeRoot: join(directory, 'runtime'),
    });
    resources.push({ repository: reopened, directory });
    expect(reopened.list({ limit: 25, offset: 0 }).accounts[0]?.emailLogin).toBe(
      'pool-admin@example.test',
    );
  });

  it('keeps ready behind an explicit provider probe and isolates the lease', async () => {
    const { repository, directory } = createRepository(async ({ account }) => ({
      state: 'ready',
      accountMarker: account.providerAccountMarker ?? undefined,
    }));
    const account = createAccount(repository);
    const started = await repository.beginLogin(account.id, actor);
    expect(started.account.state).toBe('user_action_required');
    expect(started.lease.transport).toBe('desktop');
    expect(started.lease.webRemote).toBe(false);
    const runtimePath = join(directory, 'runtime', account.profileIsolationId);
    expect(statSync(runtimePath).isDirectory()).toBe(true);

    const ready = await repository.completeLogin(account.id, started.lease.handle);
    expect(ready.state).toBe('ready');
    expect(ready.lastVerifiedAt).toBeTruthy();

    const rawDatabase = readFileSync(join(directory, 'app.db')).toString('utf8');
    expect(rawDatabase).not.toContain(started.lease.handle);
    await expect(repository.completeLogin(account.id, started.lease.handle)).rejects.toThrow(
      'linkedin_login_lease_expired',
    );
  });

  it('does not claim a session when the runtime probe is unavailable', async () => {
    const { repository } = createRepository();
    const account = createAccount(repository);
    const started = await repository.beginLogin(account.id, actor);
    const result = await repository.completeLogin(account.id, started.lease.handle);

    expect(result.state).toBe('login_required');
    expect(result.lastFailureCode).toBe('session_runtime_unavailable');
  });

  it('accepts the native provider inspection for an arbitrary admin identifier', async () => {
    const { repository } = createRepository();
    const account = repository.create({
      adminLabel: 'LinkedIn-1',
      emailLogin: 'LinkedIn-1',
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      ...actor,
    }).account;
    const started = await repository.beginLogin(account.id, actor);

    const ready = await repository.completeLogin(account.id, started.lease.handle, {
      state: 'ready',
      accountMarker: 'linkedin-profile-marker',
    });

    expect(ready.emailLogin).toBe('LinkedIn-1');
    expect(ready.state).toBe('ready');
    expect(ready.providerAccountMarker).toBe('linkedin-profile-marker');

    const recheck = await repository.beginLogin(account.id, actor);
    expect(recheck.account.state).toBe('user_action_required');
    const checked = await repository.completeLogin(account.id, recheck.lease.handle, {
      state: 'ready',
      accountMarker: 'linkedin-profile-marker',
    });
    expect(checked.state).toBe('ready');
    expect(checked.lastVerifiedAt).toBeTruthy();
  });

  it('requires a profile marker before a manual login can become ready', async () => {
    const { repository } = createRepository();
    const account = createAccount(repository);
    const login = await repository.beginLogin(account.id, actor);

    await expect(
      repository.completeLogin(account.id, login.lease.handle, { state: 'ready' }),
    ).rejects.toThrow('linkedin_provider_marker_required');
    await expect(
      repository.completeLogin(account.id, login.lease.handle, {
        state: 'ready',
        accountMarker: 'marker-1',
      }),
    ).resolves.toMatchObject({ state: 'ready', providerAccountMarker: 'marker-1' });
  });

  it('uses optimistic revision and deletes the exact profile runtime on delete', () => {
    const { repository, directory } = createRepository();
    const account = createAccount(repository);
    expect(() =>
      repository.update({
        accountId: account.id,
        revision: 9,
        adminLabel: 'stale',
        ...actor,
      }),
    ).toThrow(LinkedinPoolConflictError);

    repository.delete(account.id, account.revision, actor);
    expect(repository.list({ limit: 25, offset: 0 }).total).toBe(0);
    expect(() => statSync(join(directory, 'runtime', account.profileIsolationId))).toThrow();
  });

  it('encrypts server session cookies, reports only metadata, and survives repository restart', async () => {
    const { repository, directory } = createRepository();
    const account = createAccount(repository);
    await markAccountReady(repository, account.id);
    const cookies = sessionCookies();

    const summary = repository.storeSessionCookies(account.id, cookies, actor);

    expect(summary.cookieCount).toBe(2);
    expect(summary.expiresAt).toBe(new Date(cookies[0]!.expiresAt! * 1_000).toISOString());
    expect(repository.list({ limit: 25, offset: 0 }).accounts[0]?.serverSession).toEqual(summary);
    expect(repository.readSessionCookies(account.id)).toEqual([
      { ...cookies[0], domain: 'linkedin.com' },
      { ...cookies[1], domain: 'www.linkedin.com' },
    ]);
    const stored = repository
      .getDatabase()
      .prepare('SELECT cookies_cipher FROM linkedin_pool_sessions WHERE account_id = ?')
      .get(account.id) as { cookies_cipher: string };
    expect(stored.cookies_cipher).not.toContain('synthetic-linkedin-session-secret');
    expect(stored.cookies_cipher).not.toContain('li_at');
    expect(JSON.stringify(summary)).not.toContain('synthetic-linkedin-session-secret');
    const audit = repository
      .getDatabase()
      .prepare("SELECT detail FROM linkedin_pool_audit WHERE action = 'server_session_stored'")
      .get() as { detail: string };
    expect(audit.detail).toContain('2 LinkedIn cookies');
    expect(audit.detail).not.toContain('synthetic-linkedin-session-secret');

    resources.pop();
    repository.close();
    const reopened = new SqliteLinkedinPoolRepository({
      databasePath: join(directory, 'app.db'),
      encryptionKey,
      runtimeRoot: join(directory, 'runtime'),
    });
    resources.push({ repository: reopened, directory });
    expect(reopened.readSessionCookies(account.id)).toEqual([
      { ...cookies[0], domain: 'linkedin.com' },
      { ...cookies[1], domain: 'www.linkedin.com' },
    ]);
  });

  it('rejects incomplete, out-of-scope, insecure and expired sessions; delete and revoke remove stored copies', async () => {
    const { repository } = createRepository();
    const account = createAccount(repository);
    await markAccountReady(repository, account.id);
    const valid = sessionCookies();
    const withoutLiAt = [valid[1]!];
    const outsideDomain = [{ ...valid[0]!, domain: 'notlinkedin.com' }];
    const insecureLiAt = [{ ...valid[0]!, secure: false }];
    const missingExpiry = [{ ...valid[0]!, expiresAt: null }];
    const expired = sessionCookies(Math.floor((Date.now() - 1_000) / 1_000));

    expect(() => repository.storeSessionCookies(account.id, withoutLiAt, actor)).toThrow(
      'linkedin_session_cookie_required',
    );
    expect(() => repository.storeSessionCookies(account.id, outsideDomain, actor)).toThrow(
      'linkedin_session_cookie_invalid',
    );
    expect(() => repository.storeSessionCookies(account.id, insecureLiAt, actor)).toThrow(
      'linkedin_session_cookie_required',
    );
    expect(() => repository.storeSessionCookies(account.id, missingExpiry, actor)).toThrow(
      'linkedin_session_expiry_required',
    );
    expect(() => repository.storeSessionCookies(account.id, expired, actor)).toThrow(
      'linkedin_session_expired',
    );

    repository.storeSessionCookies(account.id, valid, actor);
    expect(repository.deleteSessionCookies(account.id, actor)).toBe(true);
    expect(repository.deleteSessionCookies(account.id, actor)).toBe(false);
    repository.storeSessionCookies(account.id, valid, actor);
    repository.revoke(account.id, actor);
    expect(repository.readSessionCookies(account.id)).toBeNull();
    expect(repository.list({ limit: 25, offset: 0 }).accounts[0]?.serverSession).toBeNull();
  });

  it('purges expired encrypted sessions from summaries and trusted reads', async () => {
    const { repository } = createRepository();
    const account = createAccount(repository);
    await markAccountReady(repository, account.id);
    const cookies = sessionCookies();

    repository.storeSessionCookies(account.id, cookies, actor);
    repository
      .getDatabase()
      .prepare("UPDATE linkedin_pool_sessions SET expires_at = '2000-01-01T00:00:00.000Z'")
      .run();
    expect(repository.list({ limit: 25, offset: 0 }).accounts[0]?.serverSession).toBeNull();
    expect(
      repository
        .getDatabase()
        .prepare('SELECT COUNT(*) AS count FROM linkedin_pool_sessions')
        .get(),
    ).toMatchObject({ count: 0 });

    repository.storeSessionCookies(account.id, cookies, actor);
    repository
      .getDatabase()
      .prepare("UPDATE linkedin_pool_sessions SET expires_at = '2000-01-01T00:00:00.000Z'")
      .run();
    expect(repository.readSessionCookies(account.id)).toBeNull();
    expect(
      repository
        .getDatabase()
        .prepare('SELECT COUNT(*) AS count FROM linkedin_pool_sessions')
        .get(),
    ).toMatchObject({ count: 0 });
  });
});
