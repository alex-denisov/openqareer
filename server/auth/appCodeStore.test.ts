import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { AppCodeStore, challengeOf } from './appCodeStore';

const VERIFIER = 'v'.repeat(43);
const CHALLENGE = challengeOf(VERIFIER);
const cleanup: { store: AppCodeStore; directory: string }[] = [];

afterEach(() => {
  for (const item of cleanup.splice(0)) {
    item.store.close();
    rmSync(item.directory, { recursive: true, force: true });
  }
});

function openStore() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-app-code-'));
  const databasePath = join(directory, 'auth.db');
  const setup = new DatabaseSync(databasePath);
  setup.exec(`CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('u1'), ('u2');`);
  setup.close();
  const store = new AppCodeStore({ databasePath });
  cleanup.push({ store, directory });
  return { store, databasePath };
}

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 23, 1, 0, seconds));

function countRows(databasePath: string): number {
  const database = new DatabaseSync(databasePath);
  const row = database.prepare('SELECT COUNT(*) AS n FROM app_sign_in_codes').get() as {
    n: number;
  };
  database.close();
  return row.n;
}

describe('B755: код входа в приложение', () => {
  it('challenge — base64url(SHA-256(verifier)), как в PKCE S256', () => {
    expect(CHALLENGE).toBe(createHash('sha256').update(VERIFIER).digest('base64url'));
    expect(CHALLENGE).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('код с верным verifier отдаёт пользователя один раз', () => {
    const { store } = openStore();
    const code = store.issue('u1', CHALLENGE, at(0));
    expect(store.redeem(code, VERIFIER, at(10))).toBe('u1');
    expect(store.redeem(code, VERIFIER, at(11))).toBeNull();
  });

  it('чужой verifier не подходит, и код после этого сгорает', () => {
    const { store } = openStore();
    const code = store.issue('u1', CHALLENGE, at(0));
    expect(store.redeem(code, 'x'.repeat(43), at(1))).toBeNull();
    expect(store.redeem(code, VERIFIER, at(2))).toBeNull();
  });

  it('через 60 секунд код недействителен', () => {
    const { store } = openStore();
    const code = store.issue('u1', CHALLENGE, at(0));
    expect(store.redeem(code, VERIFIER, at(60))).toBeNull();
  });

  it('неверный вид кода или verifier — отказ, код остаётся живым', () => {
    const { store } = openStore();
    const code = store.issue('u1', CHALLENGE, at(0));
    expect(store.redeem('oqa_short', VERIFIER, at(1))).toBeNull();
    expect(store.redeem(code, 'short', at(1))).toBeNull();
    expect(store.redeem(code, VERIFIER, at(2))).toBe('u1');
  });

  it('в базе только отпечатки кода и challenge', () => {
    const { store, databasePath } = openStore();
    const code = store.issue('u1', CHALLENGE, at(0));
    const database = new DatabaseSync(databasePath);
    const stored = JSON.stringify(database.prepare('SELECT * FROM app_sign_in_codes').all());
    database.close();
    expect(stored).not.toContain(code);
    expect(stored).not.toContain(CHALLENGE);
  });

  it('просроченные строки удаляются при выдаче нового кода', () => {
    const { store, databasePath } = openStore();
    store.issue('u1', CHALLENGE, at(0));
    store.issue('u2', CHALLENGE, at(61));
    expect(countRows(databasePath)).toBe(1);
  });
});
