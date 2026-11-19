import { createHash, createHmac, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import { SealedText } from '../data/sealedText';
import { deriveKey } from './derivedHmacKey';
import { generateTotpSecret, matchTotp } from './totp';
import { TWO_FACTOR_SCHEMA } from './twoFactorSchema';

const BACKUP_CODES = 8;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const CHALLENGE_MS = 5 * 60_000;
const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export type TwoFactorCheck = 'ok' | 'invalid' | 'locked';
/**
 * Попытки считаются отдельно: на шаге входа (`login`) и в открытой сессии (`session`). Знающий только
 * пароль исчерпает попытки входа, но не запрёт владельцу отключение, новые коды и смену пароля.
 */
export type AttemptScope = 'login' | 'session';
const COUNTERS = {
  login: { count: 'failed_count', since: 'failed_since' },
  session: { count: 'session_failed_count', since: 'session_failed_since' },
} as const;
export type ConfirmResult =
  | { readonly status: 'enabled'; readonly backupCodes: readonly string[] }
  | { readonly status: 'invalid' | 'locked' | 'no_setup' };

interface FactorRow {
  secret_cipher: string | null;
  pending_cipher: string | null;
  enabled_at: string | null;
  last_step: number;
  failed_count: number;
  failed_since: string | null;
  session_failed_count: number;
  session_failed_since: string | null;
}

function backupCode(): string {
  const bytes = randomBytes(10);
  const chars = [...bytes].map((byte) => BACKUP_ALPHABET[byte % BACKUP_ALPHABET.length]);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** B401: секрет TOTP запечатан, резервные коды — только HMAC, код принимается один раз за шаг. */
export class TwoFactorStore {
  private readonly database: DatabaseSync;
  private readonly sealed: SealedText;
  private readonly backupKey: Buffer;

  constructor(options: { readonly databasePath: string; readonly encryptionKey: Buffer }) {
    this.database = new DatabaseSync(options.databasePath);
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(TWO_FACTOR_SCHEMA);
    this.sealed = new SealedText(options.encryptionKey);
    this.backupKey = deriveKey(options.encryptionKey, 'two-factor-backup-code');
  }

  close(): void {
    this.database.close();
  }

  private row(userId: string): FactorRow | undefined {
    return this.database.prepare('SELECT * FROM user_two_factor WHERE user_id = ?').get(userId) as FactorRow | undefined;
  }

  private scope(userId: string): string {
    return `totp:${userId}`;
  }

  private hashBackup(userId: string, code: string): string {
    return createHmac('sha256', this.backupKey).update(`${userId}\0${code.trim().toLowerCase()}`).digest('hex');
  }

  hasPendingSetup(userId: string): boolean {
    return Boolean(this.row(userId)?.pending_cipher);
  }

  isEnabled(userId: string): boolean {
    return Boolean(this.row(userId)?.enabled_at);
  }

  status(userId: string): { readonly enabled: boolean; readonly backupCodesLeft: number } {
    if (!this.isEnabled(userId)) return { enabled: false, backupCodesLeft: 0 };
    const left = this.database
      .prepare('SELECT COUNT(*) AS n FROM user_two_factor_backup_codes WHERE user_id = ? AND used_at IS NULL')
      .get(userId) as { n: number };
    return { enabled: true, backupCodesLeft: left.n };
  }

  /** Новый секрет ждёт подтверждения кодом; включённая защита не меняется, пока он не подтверждён. */
  beginSetup(userId: string, now: Date): string {
    const secret = generateTotpSecret();
    this.database
      .prepare(
        `INSERT INTO user_two_factor (user_id, pending_cipher, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET pending_cipher = excluded.pending_cipher, updated_at = excluded.updated_at`,
      )
      .run(userId, this.sealed.seal(secret, this.scope(userId)), now.toISOString());
    return secret;
  }

  confirmSetup(userId: string, code: string, now: Date): ConfirmResult {
    const row = this.row(userId);
    if (!row?.pending_cipher) return { status: 'no_setup' };
    if (this.locked(row, now, 'session')) return { status: 'locked' };
    const secret = this.sealed.open(row.pending_cipher, this.scope(userId));
    const step = matchTotp(secret, code, Math.floor(now.getTime() / 1000));
    if (step === null) {
      this.recordFailure(userId, row, now, 'session');
      return { status: 'invalid' };
    }
    this.database
      .prepare(
        `UPDATE user_two_factor SET secret_cipher = pending_cipher, pending_cipher = NULL, enabled_at = ?,
           last_step = ?, session_failed_count = 0, session_failed_since = NULL, updated_at = ? WHERE user_id = ?`,
      )
      .run(now.toISOString(), step, now.toISOString(), userId);
    return { status: 'enabled', backupCodes: this.regenerateBackupCodes(userId) };
  }

  /** Код приложения или резервный код. Неверный считается попыткой; после пяти — пауза 15 минут. */
  verify(userId: string, code: string, now: Date, scope: AttemptScope): TwoFactorCheck {
    const row = this.row(userId);
    if (!row?.enabled_at || !row.secret_cipher) return 'invalid';
    if (this.locked(row, now, scope)) return 'locked';
    if (this.acceptTotp(userId, row, code, now) || this.acceptBackup(userId, code, now)) {
      const { count, since } = COUNTERS[scope];
      this.database.prepare(`UPDATE user_two_factor SET ${count} = 0, ${since} = NULL WHERE user_id = ?`).run(userId);
      return 'ok';
    }
    this.recordFailure(userId, row, now, scope);
    return 'invalid';
  }

  private acceptTotp(userId: string, row: FactorRow, code: string, now: Date): boolean {
    const secret = this.sealed.open(row.secret_cipher as string, this.scope(userId));
    const step = matchTotp(secret, code, Math.floor(now.getTime() / 1000));
    if (step === null) return false;
    // Шаг записывается условно: код того же или прежнего шага второй раз не пройдёт.
    const result = this.database
      .prepare('UPDATE user_two_factor SET last_step = ?, updated_at = ? WHERE user_id = ? AND last_step < ?')
      .run(step, now.toISOString(), userId, step);
    return Number(result.changes) === 1;
  }

  private acceptBackup(userId: string, code: string, now: Date): boolean {
    if (!/^[a-z0-9]{5}-[a-z0-9]{5}$/iu.test(code.trim())) return false;
    const result = this.database
      .prepare(
        'UPDATE user_two_factor_backup_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
      )
      .run(now.toISOString(), userId, this.hashBackup(userId, code));
    return Number(result.changes) === 1;
  }

  /** Попытки исчерпаны: ни код, ни пароль до конца паузы не принимаются. */
  isLocked(userId: string, now: Date, scope: AttemptScope): boolean {
    const row = this.row(userId);
    return row ? this.locked(row, now, scope) : false;
  }

  /** Неверный пароль вместо кода — такая же попытка. Без строки защиты считать нечего: вызывающий проверяет её раньше. */
  noteFailure(userId: string, now: Date, scope: AttemptScope): void {
    const row = this.row(userId);
    if (row) this.recordFailure(userId, row, now, scope);
  }

  private locked(row: FactorRow, now: Date, scope: AttemptScope): boolean {
    const { count, since } = COUNTERS[scope];
    const started = row[since];
    if (row[count] < MAX_FAILURES || !started) return false;
    return now.getTime() - Date.parse(started) < LOCK_MS;
  }

  private recordFailure(userId: string, row: FactorRow, now: Date, scope: AttemptScope): void {
    const { count, since } = COUNTERS[scope];
    const started = row[since];
    const stale = !started || now.getTime() - Date.parse(started) >= LOCK_MS;
    this.database
      .prepare(`UPDATE user_two_factor SET ${count} = ?, ${since} = ? WHERE user_id = ?`)
      .run(stale ? 1 : row[count] + 1, stale ? now.toISOString() : started, userId);
  }

  /** Пароль сменён или сброшен: начатые входы по старому паролю больше не завершить. */
  dropChallenges(userId: string): void {
    this.database.prepare('DELETE FROM two_factor_login_challenges WHERE user_id = ?').run(userId);
  }

  /** Восемь новых кодов; прежние перестают действовать. Показываются один раз — здесь. */
  regenerateBackupCodes(userId: string): string[] {
    const codes = Array.from({ length: BACKUP_CODES }, backupCode);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('DELETE FROM user_two_factor_backup_codes WHERE user_id = ?').run(userId);
      const insert = this.database.prepare('INSERT INTO user_two_factor_backup_codes (user_id, code_hash) VALUES (?, ?)');
      for (const code of codes) insert.run(userId, this.hashBackup(userId, code));
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return codes;
  }

  disable(userId: string): void {
    this.database.prepare('DELETE FROM user_two_factor_backup_codes WHERE user_id = ?').run(userId);
    this.database.prepare('DELETE FROM two_factor_login_challenges WHERE user_id = ?').run(userId);
    this.database.prepare('DELETE FROM user_two_factor WHERE user_id = ?').run(userId);
  }

  /** Вход прошёл по паролю — до сессии нужен код; вызов живёт 5 минут. */
  createChallenge(userId: string, clientDeviceId: string | null, now: Date): string {
    const token = `oq2_${randomBytes(32).toString('base64url')}`;
    this.database
      .prepare('DELETE FROM two_factor_login_challenges WHERE expires_at <= ?')
      .run(now.toISOString());
    this.database
      .prepare('INSERT INTO two_factor_login_challenges (token_hash, user_id, client_device_id, expires_at) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), userId, clientDeviceId, new Date(now.getTime() + CHALLENGE_MS).toISOString());
    return token;
  }

  readChallenge(token: string, now: Date): { readonly userId: string; readonly clientDeviceId: string | null } | null {
    if (!/^oq2_[A-Za-z0-9_-]{40,}$/u.test(token)) return null;
    const row = this.database
      .prepare(
        `SELECT user_id, client_device_id FROM two_factor_login_challenges
         WHERE token_hash = ? AND expires_at > ? AND attempts < ?`,
      )
      .get(hashToken(token), now.toISOString(), MAX_FAILURES) as { user_id: string; client_device_id: string | null } | undefined;
    return row ? { userId: row.user_id, clientDeviceId: row.client_device_id } : null;
  }

  failChallenge(token: string): void {
    this.database
      .prepare('UPDATE two_factor_login_challenges SET attempts = attempts + 1 WHERE token_hash = ?')
      .run(hashToken(token));
  }

  consumeChallenge(token: string): void {
    this.database.prepare('DELETE FROM two_factor_login_challenges WHERE token_hash = ?').run(hashToken(token));
  }
}
