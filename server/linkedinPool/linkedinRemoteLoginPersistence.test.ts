import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Cookie } from 'playwright';
import { persistRemoteLogin, toPoolSessionCookies } from './linkedinRemoteLoginPersistence';
import { SqliteLinkedinPoolRepository } from './sqliteLinkedinPoolRepository';

const actor = { actorUserId: 'admin-1', actorUsername: 'admin.test' };
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function cookie(overrides: Partial<Cookie>): Cookie {
  return {
    name: 'li_at',
    value: 'synthetic-secret',
    domain: '.linkedin.com',
    path: '/',
    expires: Math.floor(Date.now() / 1_000) + 3_600,
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    ...overrides,
  };
}

describe('persistRemoteLogin', () => {
  it('keeps only usable LinkedIn cookies', () => {
    const result = toPoolSessionCookies([
      cookie({}),
      cookie({ name: 'x', domain: 'evil.example' }),
      cookie({ name: 'bad', value: 'a;b' }),
      cookie({ name: 'session-only', expires: -1 }),
    ]);
    expect(result.map((item) => item.name)).toEqual(['li_at', 'session-only']);
    expect(result[1]?.expiresAt).toBeNull();
  });

  it('turns a login-required account ready and stores the session', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-remote-persist-'));
    directories.push(directory);
    const repository = new SqliteLinkedinPoolRepository({
      databasePath: join(directory, 'pool.db'),
      encryptionKey: Buffer.alloc(32, 5),
      runtimeRoot: join(directory, 'runtime'),
    });
    try {
      const account = repository.create({
        adminLabel: 'Аккаунт пула',
        emailLogin: 'pool@example.test',
        idempotencyKey: crypto.randomUUID(),
        ...actor,
      }).account;
      await persistRemoteLogin(repository, account.id, [cookie({})], actor);
      const after = repository.findAccount(account.id);
      expect(after?.state).toBe('ready');
      expect(after?.serverSession?.cookieCount).toBe(1);
      expect(repository.readSessionCookies(account.id)?.[0]?.name).toBe('li_at');
    } finally {
      repository.close();
    }
  });
});
