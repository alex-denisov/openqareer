import { mkdtempSync, rmSync, statSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireProfileLock,
  ensureLinkedinProfileDirectory,
  linkedinProfileDirectory,
  linkedinProfileExists,
  PROFILE_LOCK_STALE_MS,
  releaseProfileLock,
  touchProfileLock,
} from './linkedinProfileDirectory';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function temp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-profile-'));
  directories.push(directory);
  return directory;
}

describe('linkedinProfileDirectory', () => {
  it('derives the profile next to the database and rejects path tricks', () => {
    expect(linkedinProfileDirectory('/var/lib/openqareer/openqareer.db', ACCOUNT)).toBe(
      `/var/lib/openqareer/linkedin-profiles/${ACCOUNT}`,
    );
    expect(() => linkedinProfileDirectory('/var/lib/x.db', '../etc')).toThrow(
      'linkedin_profile_account_id_invalid',
    );
  });

  it('creates the profile with owner-only rights and reports existence', () => {
    const profile = join(temp(), 'linkedin-profiles', ACCOUNT);
    expect(linkedinProfileExists(profile)).toBe(false);
    ensureLinkedinProfileDirectory(profile);
    expect(linkedinProfileExists(profile)).toBe(true);
    expect(statSync(profile).mode & 0o777).toBe(0o700);
  });

  describe('lock', () => {
    const now = new Date('2026-10-05T10:00:00.000Z');
    const alive = () => true;

    it('is exclusive between owners', () => {
      const profile = temp();
      expect(acquireProfileLock(profile, 'login', { now, pid: 10, isAlive: alive })).toBe(true);
      expect(acquireProfileLock(profile, 'executor', { now, pid: 11, isAlive: alive })).toBe(false);
      expect(JSON.parse(readFileSync(join(profile, '.lock'), 'utf8'))).toMatchObject({
        pid: 10,
        owner: 'login',
      });
    });

    it('is released only by its owner', () => {
      const profile = temp();
      acquireProfileLock(profile, 'login', { now, pid: 10, isAlive: alive });
      releaseProfileLock(profile, 'executor');
      expect(existsSync(join(profile, '.lock'))).toBe(true);
      releaseProfileLock(profile, 'login');
      expect(existsSync(join(profile, '.lock'))).toBe(false);
    });

    it('drops a lock older than 15 minutes', () => {
      const profile = temp();
      acquireProfileLock(profile, 'login', { now, pid: 10, isAlive: alive });
      const later = new Date(now.getTime() + PROFILE_LOCK_STALE_MS + 1);
      expect(acquireProfileLock(profile, 'executor', { now: later, pid: 11, isAlive: alive })).toBe(true);
    });

    it('keeps a lock alive while its owner touches it', () => {
      const profile = temp();
      acquireProfileLock(profile, 'login', { now, pid: 10, isAlive: alive });
      const mid = new Date(now.getTime() + 10 * 60_000);
      touchProfileLock(profile, 'login', { now: mid, pid: 10 });
      const later = new Date(mid.getTime() + 10 * 60_000);
      expect(acquireProfileLock(profile, 'executor', { now: later, pid: 11, isAlive: alive })).toBe(false);
    });

    it('drops a fresh lock whose process is gone and a broken lock file', () => {
      const profile = temp();
      acquireProfileLock(profile, 'login', { now, pid: 10, isAlive: alive });
      expect(acquireProfileLock(profile, 'executor', { now, pid: 11, isAlive: () => false })).toBe(true);
      writeFileSync(join(profile, '.lock'), 'not json');
      releaseProfileLock(profile, 'executor');
      expect(acquireProfileLock(profile, 'login', { now, pid: 12, isAlive: alive })).toBe(true);
    });
  });
});
