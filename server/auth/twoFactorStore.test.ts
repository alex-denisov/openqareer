import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { totpAt } from './totp';
import { TwoFactorStore } from './twoFactorStore';

const KEY = Buffer.alloc(32, 3);
const T0 = new Date('2026-11-19T10:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const unix = (date: Date) => Math.floor(date.getTime() / 1000);
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'oq-2fa-'));
  dirs.push(dir);
  const databasePath = join(dir, 'db.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
  db.prepare('INSERT INTO users (id) VALUES (?), (?)').run('u1', 'u2');
  db.close();
  const store = new TwoFactorStore({ databasePath, encryptionKey: KEY });
  return { store, databasePath };
}

function enable(store: TwoFactorStore, userId = 'u1') {
  const secret = store.beginSetup(userId, T0);
  const result = store.confirmSetup(userId, totpAt(secret, unix(T0)), T0);
  if (result.status !== 'enabled') throw new Error(result.status);
  return { secret, codes: result.backupCodes };
}

describe('B401: двухфакторная защита — хранилище', () => {
  it('is off until setup is confirmed with a valid code; the secret is stored sealed', () => {
    const { store, databasePath } = setup();
    expect(store.status('u1')).toEqual({ enabled: false, backupCodesLeft: 0 });
    const secret = store.beginSetup('u1', T0);
    expect(store.confirmSetup('u1', '000000', T0).status).toBe('invalid');
    expect(store.isEnabled('u1')).toBe(false);
    const db = new DatabaseSync(databasePath);
    const raw = JSON.stringify(db.prepare('SELECT * FROM user_two_factor').all());
    db.close();
    expect(raw).not.toContain(secret);
    const done = store.confirmSetup('u1', totpAt(secret, unix(T0)), T0);
    expect(done.status).toBe('enabled');
    expect(store.status('u1')).toEqual({ enabled: true, backupCodesLeft: 8 });
  });

  it('gives 8 distinct backup codes once, stores only hashes, each works once', () => {
    const { store, databasePath } = setup();
    const { codes } = enable(store);
    expect(new Set(codes).size).toBe(8);
    const db = new DatabaseSync(databasePath);
    const raw = JSON.stringify(db.prepare('SELECT * FROM user_two_factor_backup_codes').all());
    db.close();
    for (const code of codes) expect(raw).not.toContain(code);
    expect(store.verify('u1', codes[0], at(60), 'login')).toBe('ok');
    expect(store.verify('u1', codes[0], at(61), 'login')).toBe('invalid');
    expect(store.status('u1').backupCodesLeft).toBe(7);
  });

  it('a code is accepted once per window: no replay', () => {
    const { store } = setup();
    const { secret } = enable(store);
    const code = totpAt(secret, unix(at(60)));
    expect(store.verify('u1', code, at(60), 'login')).toBe('ok');
    expect(store.verify('u1', code, at(65), 'login')).toBe('invalid');
    // Код установки тоже израсходован.
    expect(store.verify('u1', totpAt(secret, unix(T0)), at(10), 'login')).toBe('invalid');
    expect(store.verify('u1', totpAt(secret, unix(at(90))), at(90), 'login')).toBe('ok');
  });

  it('locks after 5 wrong codes for 15 minutes; a right code then is refused', () => {
    const { store } = setup();
    const { secret } = enable(store);
    for (let i = 0; i < 5; i += 1) expect(store.verify('u1', '123456', at(60 + i), 'login')).toBe('invalid');
    expect(store.verify('u1', totpAt(secret, unix(at(70))), at(70), 'login')).toBe('locked');
    const later = at(60 + 15 * 60 + 1);
    expect(store.verify('u1', totpAt(secret, unix(later)), later, 'login')).toBe('ok');
  });

  it('new backup codes replace the old ones; disabling clears everything', () => {
    const { store } = setup();
    const { codes } = enable(store);
    const fresh = store.regenerateBackupCodes('u1');
    expect(fresh).toHaveLength(8);
    expect(store.verify('u1', codes[1], at(60), 'login')).toBe('invalid');
    expect(store.verify('u1', fresh[1], at(61), 'login')).toBe('ok');
    store.disable('u1');
    expect(store.status('u1')).toEqual({ enabled: false, backupCodesLeft: 0 });
  });

  it('login challenge: single use, bound to the user, expires in 5 minutes, 5 attempts', () => {
    const { store } = setup();
    enable(store);
    const token = store.createChallenge('u1', 'dev-1', T0);
    expect(store.readChallenge('oq2_nope', T0)).toBeNull();
    expect(store.readChallenge(token, at(5 * 60 + 1))).toBeNull();
    expect(store.readChallenge(token, at(10))).toEqual({ userId: 'u1', clientDeviceId: 'dev-1' });
    for (let i = 0; i < 5; i += 1) store.failChallenge(token);
    expect(store.readChallenge(token, at(11))).toBeNull();
    const second = store.createChallenge('u1', null, T0);
    store.consumeChallenge(second);
    expect(store.readChallenge(second, at(1))).toBeNull();
  });

  it('is scoped per user', () => {
    const { store } = setup();
    enable(store);
    expect(store.isEnabled('u2')).toBe(false);
    expect(store.verify('u2', '123456', T0, 'login')).toBe('invalid');
  });
});
