import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LinkedinPoolConflictError,
  SqliteLinkedinPoolRepository,
  type LinkedinSessionProbe,
} from './sqliteLinkedinPoolRepository';

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

describe('SqliteLinkedinPoolRepository', () => {
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
});
