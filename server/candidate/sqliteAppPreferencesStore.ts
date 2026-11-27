import { DatabaseSync } from 'node:sqlite';
import type { AppMoneyCurrency, AppTheme, B640AppPreferences } from '../../shared/b640AppPreferences';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

/** B593: новая таблица; строка уходит вместе с кандидатом. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_app_preferences (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  theme TEXT CHECK (theme IN ('light', 'dark', 'system')),
  money_currency TEXT CHECK (money_currency IN ('RUB', 'USD', 'EUR', 'AED')),
  updated_at TEXT NOT NULL
) STRICT;
`;

interface Row {
  theme: AppTheme | null;
  money_currency: AppMoneyCurrency | null;
}

export type AppPreferencesPatch = Partial<{ theme: AppTheme; moneyCurrency: AppMoneyCurrency }>;

export class SqliteAppPreferencesStore {
  private readonly database: DatabaseSync;

  constructor(options: { readonly databasePath: string }) {
    this.database = new DatabaseSync(options.databasePath);
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(SCHEMA);
  }

  close(): void {
    this.database.close();
  }

  get(candidateId: string): B640AppPreferences {
    const row = this.database
      .prepare('SELECT theme, money_currency FROM candidate_app_preferences WHERE candidate_id = ?')
      .get(candidateId) as Row | undefined;
    return { theme: row?.theme ?? null, moneyCurrency: row?.money_currency ?? null };
  }

  /** Меняет только переданные поля одной записью: параллельные PUT разных полей не затирают друг друга. */
  patch(candidateId: string, patch: AppPreferencesPatch, now: string): B640AppPreferences {
    this.database
      .prepare(
        `INSERT INTO candidate_app_preferences (candidate_id, theme, money_currency, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET theme = COALESCE(excluded.theme, theme),
           money_currency = COALESCE(excluded.money_currency, money_currency), updated_at = excluded.updated_at`,
      )
      .run(candidateId, patch.theme ?? null, patch.moneyCurrency ?? null, now);
    return this.get(candidateId);
  }
}
