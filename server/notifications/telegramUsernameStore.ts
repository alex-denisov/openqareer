import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import type { SealedText } from '../data/sealedText';

/**
 * B690: имя кандидата в Telegram для строки «Telegram · @имя» (n02). Хранится
 * зашифрованным в своей таблице и только для кандидатов нового кабинета;
 * идентификатор чата сюда не попадает и наружу не отдаётся.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_telegram_usernames (
  candidate_id TEXT PRIMARY KEY,
  username_cipher TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

const USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/u;

/** Имя пользователя Telegram: 5–32 знака, латиница, цифры и `_`, с буквы. */
export function normalizeTelegramUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.startsWith('@') ? raw.slice(1) : raw;
  return USERNAME.test(value) ? value : null;
}

const associated = (candidateId: string) => `telegram-username:${candidateId}`;

export type TelegramLinkStateName = 'none' | 'waiting' | 'expired' | 'connected';

/** Состояние привязки: чат привязан; ссылка ещё действует; ссылка устарела; ничего. */
export function telegramLinkState(input: {
  readonly connected: boolean;
  readonly codeExpiresAt: string | null;
  readonly now: string;
}): { readonly state: TelegramLinkStateName; readonly expiresAt: string | null } {
  if (input.connected) return { state: 'connected', expiresAt: null };
  if (!input.codeExpiresAt) return { state: 'none', expiresAt: null };
  return input.codeExpiresAt > input.now
    ? { state: 'waiting', expiresAt: input.codeExpiresAt }
    : { state: 'expired', expiresAt: null };
}

export class SqliteTelegramUsernameStore {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;

  constructor(
    options: DatabaseSync | { databasePath: string },
    private readonly sealed: SealedText,
  ) {
    if (options instanceof DatabaseSync) {
      this.database = options;
      this.ownsDatabase = false;
    } else {
      this.database = new DatabaseSync(options.databasePath);
      this.database.exec('PRAGMA journal_mode = WAL;');
      applySqliteBusyTimeout(this.database);
      this.ownsDatabase = true;
    }
    this.database.exec(SCHEMA);
  }

  save(candidateId: string, username: string, now = new Date().toISOString()): void {
    this.database
      .prepare(
        `INSERT INTO candidate_telegram_usernames (candidate_id, username_cipher, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET username_cipher = excluded.username_cipher, updated_at = excluded.updated_at`,
      )
      .run(candidateId, this.sealed.seal(username, associated(candidateId)), now);
  }

  get(candidateId: string): string | null {
    const row = this.database
      .prepare('SELECT username_cipher FROM candidate_telegram_usernames WHERE candidate_id = ?')
      .get(candidateId) as { username_cipher: string } | undefined;
    return row ? this.sealed.open(row.username_cipher, associated(candidateId)) : null;
  }

  remove(candidateId: string): void {
    this.database.prepare('DELETE FROM candidate_telegram_usernames WHERE candidate_id = ?').run(candidateId);
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }
}
