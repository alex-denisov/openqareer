import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import { PasskeyStore } from '../auth/passkeyStore';
import { SqliteCandidateStore } from './sqliteCandidateStore';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-passkey-export-'));
  directories.push(directory);
  const databasePath = join(directory, 'app.db');
  const candidates = new SqliteCandidateStore({ databasePath, encryptionKey: Buffer.alloc(32, 8) });
  const auth = new AuthService({ databasePath });
  await auth.seedAccounts(
    [
      { username: 'one.test', password: 'password-for-tests-one', role: 'candidate' },
      { username: 'two.test', password: 'password-for-tests-two', role: 'candidate' },
    ],
    candidates,
  );
  const one = await auth.login('one.test', 'password-for-tests-one');
  const two = await auth.login('two.test', 'password-for-tests-two');
  return { auth, candidates, databasePath, one: one!.principal, two: two!.principal };
}

describe('B755: ключи доступа в выгрузке данных', () => {
  it('lists the label and dates of own keys only, never the key itself', async () => {
    const { auth, candidates, databasePath, one, two } = await setup();
    const store = new PasskeyStore({ databasePath });
    const key = (credentialId: string, deviceLabel: string) => ({
      credentialId,
      publicKey: new Uint8Array([9, 9, 9]),
      signCount: 4,
      transports: ['internal'],
      backedUp: false,
      deviceLabel,
    });
    const id = store.add(one.userId, key('secret-credential-id', 'MacBook · Safari'), new Date('2026-11-20T10:00:00.000Z'));
    store.add(two.userId, key('other-credential-id', 'iPhone · Safari'), new Date('2026-11-21T10:00:00.000Z'));
    store.recordUse(id as string, 4, 5, new Date('2026-11-22T09:00:00.000Z'));
    const exported = candidates.exportCandidate(one.candidate!.id);
    expect(exported.passkeys).toEqual([
      { deviceLabel: 'MacBook · Safari', createdAt: '2026-11-20T10:00:00.000Z', lastUsedAt: '2026-11-22T09:00:00.000Z' },
    ]);
    expect(JSON.stringify(exported)).not.toMatch(/secret-credential-id|other-credential-id|iPhone/u);
    store.close();
    auth.close();
    candidates.close();
  });

  it('is empty while the keys table does not exist yet', async () => {
    const { auth, candidates, one } = await setup();
    expect(candidates.exportCandidate(one.candidate!.id).passkeys).toEqual([]);
    auth.close();
    candidates.close();
  });
});
