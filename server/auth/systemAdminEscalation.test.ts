import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { AuthService } from './authService';

const directories: string[] = [];
const services: AuthService[] = [];
const stores: SqliteCandidateStore[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.close();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function openStore(): { path: string; store: SqliteCandidateStore } {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-admin-escalation-'));
  directories.push(directory);
  const path = join(directory, 'candidates.db');
  // The candidate store owns the schema the auth service migrates on top of.
  const store = new SqliteCandidateStore({
    databasePath: path,
    encryptionKey: Buffer.alloc(32, 8),
  });
  stores.push(store);
  return { path, store };
}

function openService(path: string): AuthService {
  const service = new AuthService({ databasePath: path });
  services.push(service);
  return service;
}

/**
 * Registration is public. If a role can be granted by simply owning a
 * username, then choosing that username is a privilege escalation — and the
 * grant fires on every process start, so a deploy is enough to trigger it.
 */
describe('system administrator provisioning', () => {
  it.each(['admin.test', 'alexey.admin'])(
    'does not promote a self-registered %s to administrator on restart',
    async (username) => {
      const { path, store } = openStore();
      const first = openService(path);
      await first.register(username, 'a-candidate-chosen-password', store, {
        displayName: 'Кандидат',
        email: `${username.replace('.', '-')}@example.test`,
      });
      first.close();
      services.splice(services.indexOf(first), 1);

      // A restart is all an attacker has to wait for.
      const restarted = openService(path);
      const session = await restarted.login(username, 'a-candidate-chosen-password');

      expect(session?.principal.role).toBe('candidate');
    },
  );
});
