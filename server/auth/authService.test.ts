import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
