import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { AuthService } from './authService';
import type { PasskeyAddedDelivery, PasswordResetDelivery } from './authTypes';
import { buildPasskeyAddedNotifier } from './passkeyAddedEmail';
import { dropUserPasskeys, PASSKEY_SCHEMA } from './passkeySchema';

const PASSWORD = 'candidate-password-for-tests';
const cleanup: { auth: AuthService; candidates: SqliteCandidateStore; directory: string }[] = [];

afterEach(() => {
  for (const item of cleanup.splice(0)) {
    item.auth.close();
    item.candidates.close();
    rmSync(item.directory, { recursive: true, force: true });
  }
});

async function withKey() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-passkey-reset-'));
  const databasePath = join(directory, 'auth.db');
  const candidates = new SqliteCandidateStore({ databasePath, encryptionKey: Buffer.alloc(32, 5) });
  const resets: PasswordResetDelivery[] = [];
  const added: PasskeyAddedDelivery[] = [];
  const auth = new AuthService({
    databasePath,
    onPasswordReset: async (input) => void resets.push(input),
    onPasskeyAdded: async (input) => void added.push(input),
  });
  cleanup.push({ auth, candidates, directory });
  const registered = await auth.register('Key.Owner', PASSWORD, candidates);
  const userId = registered.principal.userId;
  const database = new DatabaseSync(databasePath);
  database.exec(PASSKEY_SCHEMA);
  database.prepare('UPDATE users SET email = ? WHERE id = ?').run('key.owner@example.test', userId);
  database
    .prepare(
      `INSERT INTO user_passkeys (id, user_id, credential_id, public_key, created_at)
       VALUES ('k1', ?, 'cred-1', x'01', '2026-11-22T10:00:00.000Z')`,
    )
    .run(userId);
  const keys = () => database.prepare('SELECT id FROM user_passkeys').all();
  const token = registered.sessionToken;
  return { auth, userId, token, keys, resets, added, close: () => database.close() };
}

describe('B755: сброс пароля удаляет ключи входа', () => {
  it('сброс по письму удаляет ключи владельца', async () => {
    const owner = await withKey();
    try {
      expect(owner.keys()).toHaveLength(1);
      await owner.auth.requestPasswordReset('key.owner');
      await owner.auth.resetPassword(owner.resets[0]!.token, 'new-password-for-tests');
      expect(owner.keys()).toEqual([]);
    } finally {
      owner.close();
    }
  });

  it('сброс пароля админом удаляет ключи владельца', async () => {
    const owner = await withKey();
    try {
      await owner.auth.adminSetUserPassword(owner.userId, 'new-password-for-tests');
      expect(owner.keys()).toEqual([]);
    } finally {
      owner.close();
    }
  });

  it('смена пароля удаляет ключи владельца вместе с сеансами', async () => {
    const owner = await withKey();
    try {
      const changed = await owner.auth.changePassword(
        owner.token,
        PASSWORD,
        'new-password-for-tests',
      );
      expect(changed?.sessionToken).toBeTruthy();
      expect(owner.keys()).toEqual([]);
      expect(owner.auth.authenticate(owner.token)).toBeNull();
    } finally {
      owner.close();
    }
  });

  it('без таблицы ключей удалять нечего и ничего не падает', () => {
    const database = new DatabaseSync(':memory:');
    expect(() => dropUserPasskeys(database, 'u1')).not.toThrow();
    database.close();
  });

  it('о новом ключе владелец получает письмо на свою почту', async () => {
    const owner = await withKey();
    try {
      await owner.auth.notifyPasskeyAdded(owner.userId, 'k1', 'MacBook · Safari');
      expect(owner.added).toEqual([
        {
          email: 'key.owner@example.test',
          displayName: null,
          passkeyId: 'k1',
          deviceLabel: 'MacBook · Safari',
        },
      ]);
    } finally {
      owner.close();
    }
  });
});

describe('B755: письмо о новом ключе', () => {
  it('уходит через Resend с названием устройства и ссылкой на «Вход и безопасность»', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const send = buildPasskeyAddedNotifier({
      apiKey: 'test-key',
      from: 'openqareer <no-reply@example.test>',
      publicBaseUrl: 'https://openqareer.com',
      fetchImpl,
    });
    await send({
      email: 'key.owner@example.test',
      displayName: 'Анна <script>',
      passkeyId: 'k1',
      deviceLabel: 'MacBook · Safari',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(String(init.body)) as { to: string[]; subject: string; html: string };
    expect(body.to).toEqual(['key.owner@example.test']);
    expect(body.subject).toContain('Touch ID / Face ID');
    expect(body.html).toContain('«MacBook · Safari»');
    expect(body.html).toContain('https://openqareer.com/app/account/security');
    expect(body.html).toContain('Анна &lt;script&gt;');
  });

  it('отказ почты — ошибка с кодом ответа', async () => {
    const send = buildPasskeyAddedNotifier({
      apiKey: 'test-key',
      from: 'no-reply@example.test',
      publicBaseUrl: 'https://openqareer.com',
      fetchImpl: async () => new Response('{}', { status: 422 }),
    });
    await expect(
      send({ email: 'a@example.test', displayName: null, passkeyId: 'k1', deviceLabel: null }),
    ).rejects.toThrow('status 422');
  });
});
