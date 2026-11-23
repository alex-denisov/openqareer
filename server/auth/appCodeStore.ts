import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

const CODE_MS = 60_000;
const CODE_PATTERN = /^oqa_[A-Za-z0-9_-]{43}$/u;
/** RFC 7636: verifier 43–128 знаков из [A-Za-z0-9-._~]; приложение шлёт 43 (32 байта base64url). */
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
export const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/** B755: коды входа в приложение — строки уходят вместе с пользователем. */
const APP_CODE_SCHEMA = `
CREATE TABLE IF NOT EXISTS app_sign_in_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;
`;

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/** PKCE S256: challenge = base64url(SHA-256(verifier)). */
export function challengeOf(verifier: string): string {
  return sha256(verifier).toString('base64url');
}

/** Для отсутствующего кода сравнение идёт с пустышкой той же длины: время ответа не выдаёт, был ли код. */
const DUMMY_HASH = sha256('openqareer-app-code-dummy');

/**
 * B755: одноразовый код входа в приложение (60 с). В базе только отпечатки кода и challenge;
 * код погашается первой же попыткой обмена, удачной или нет.
 */
export class AppCodeStore {
  private readonly database: DatabaseSync;

  constructor(options: { readonly databasePath: string }) {
    this.database = new DatabaseSync(options.databasePath);
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(APP_CODE_SCHEMA);
  }

  close(): void {
    this.database.close();
  }

  issue(userId: string, challenge: string, now: Date): string {
    const code = `oqa_${randomBytes(32).toString('base64url')}`;
    this.database
      .prepare('DELETE FROM app_sign_in_codes WHERE expires_at <= ?')
      .run(now.toISOString());
    this.database
      .prepare(
        'INSERT INTO app_sign_in_codes (code_hash, user_id, challenge_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        sha256(code).toString('hex'),
        userId,
        sha256(challenge).toString('hex'),
        now.toISOString(),
        new Date(now.getTime() + CODE_MS).toISOString(),
      );
    return code;
  }

  /** Пользователь кода, если код жив и verifier к нему подходит; иначе `null`. */
  redeem(code: string, verifier: string, now: Date): string | null {
    if (!CODE_PATTERN.test(code) || !VERIFIER_PATTERN.test(verifier)) return null;
    const row = this.database
      .prepare(
        'DELETE FROM app_sign_in_codes WHERE code_hash = ? RETURNING user_id, challenge_hash, expires_at',
      )
      .get(sha256(code).toString('hex')) as
      { user_id: string; challenge_hash: string; expires_at: string } | undefined;
    const expected = row ? Buffer.from(row.challenge_hash, 'hex') : DUMMY_HASH;
    const matches = timingSafeEqual(sha256(challengeOf(verifier)), expected);
    if (!row || !matches || row.expires_at <= now.toISOString()) return null;
    return row.user_id;
  }
}
