import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { SealedText } from '../data/sealedText';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import { prepareLinkedinSessionCookies } from './serverSessionCookies';
import {
  assertTransition,
  type LinkedinFailureCode,
  type LinkedinLease,
  type LinkedinPoolAccount,
  type LinkedinPoolPage,
  type LinkedinProviderCapability,
  type LinkedinProviderProbe,
  type LinkedinPoolServerSessionSummary,
  type LinkedinSessionCookie,
  type LinkedinSessionState,
} from './sessionContract';

export interface LinkedinPoolListInput {
  readonly state?: LinkedinSessionState;
  readonly limit: number;
  readonly offset: number;
}

export interface LinkedinPoolCreateInput {
  readonly adminLabel: string;
  readonly emailLogin: string;
  readonly providerAccountMarker?: string;
  readonly idempotencyKey: string;
  readonly actorUserId: string;
  readonly actorUsername: string;
}

export interface LinkedinPoolUpdateInput {
  readonly accountId: string;
  readonly revision: number;
  readonly adminLabel?: string;
  readonly emailLogin?: string;
  readonly providerAccountMarker?: string | null;
  readonly actorUserId: string;
  readonly actorUsername: string;
}

export interface LinkedinPoolActor {
  readonly actorUserId: string;
  readonly actorUsername: string;
}

export interface LinkedinSessionProbeInput {
  readonly account: LinkedinPoolAccount;
  readonly lease?: LinkedinLease;
}

export type LinkedinSessionProbe = (
  input: LinkedinSessionProbeInput,
) => Promise<LinkedinProviderProbe>;

export interface LinkedinPoolRepositoryOptions {
  readonly databasePath: string;
  readonly encryptionKey: Buffer;
  readonly runtimeRoot?: string;
  readonly probe?: LinkedinSessionProbe;
  readonly now?: () => Date;
}

export class LinkedinPoolNotFoundError extends Error {
  constructor() {
    super('linkedin_pool_account_not_found');
    this.name = 'LinkedinPoolNotFoundError';
  }
}

export class LinkedinPoolConflictError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'LinkedinPoolConflictError';
  }
}

interface AccountRow {
  id: string;
  admin_label: string;
  email_login_cipher: string;
  email_login_digest: string;
  provider_marker_cipher: string | null;
  profile_isolation_id: string;
  state: LinkedinSessionState;
  last_verified_at: string | null;
  last_heartbeat_at: string | null;
  last_failure_code: LinkedinFailureCode | null;
  lease_until: string | null;
  capability_verdict: LinkedinProviderCapability;
  revision: number;
  created_at: string;
  updated_at: string;
  session_captured_at?: string | null;
  session_expires_at?: string | null;
  session_cookie_count?: number | null;
  session_revision?: number | null;
}

interface LeaseRow {
  account_id: string;
  token_hash: string;
  expires_at: string;
}

const LINKEDIN_POOL_SCHEMA = `
CREATE TABLE IF NOT EXISTS linkedin_pool_accounts (
  id TEXT PRIMARY KEY,
  admin_label TEXT NOT NULL,
  email_login_cipher TEXT NOT NULL,
  email_login_digest TEXT NOT NULL UNIQUE,
  provider_marker_cipher TEXT,
  profile_isolation_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN (
    'unconfigured', 'login_required', 'user_action_required', 'checking',
    'ready', 'expired', 'challenge_required', 'cooling_down', 'revoked',
    'banned', 'disabled'
  )),
  last_verified_at TEXT,
  last_heartbeat_at TEXT,
  last_failure_code TEXT,
  lease_until TEXT,
  capability_verdict TEXT NOT NULL CHECK (
    capability_verdict IN ('not_configured', 'official_api', 'provider_permitted')
  ),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS linkedin_pool_accounts_state
  ON linkedin_pool_accounts(state, created_at DESC, id ASC);
CREATE TABLE IF NOT EXISTS linkedin_pool_sessions (
  account_id TEXT PRIMARY KEY REFERENCES linkedin_pool_accounts(id) ON DELETE CASCADE,
  cookies_cipher TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  cookie_count INTEGER NOT NULL CHECK (cookie_count BETWEEN 1 AND 100),
  revision INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE IF NOT EXISTS linkedin_pool_leases (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES linkedin_pool_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS linkedin_pool_leases_account
  ON linkedin_pool_leases(account_id, expires_at);
CREATE TABLE IF NOT EXISTS linkedin_pool_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  request_digest TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS linkedin_pool_audit (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  actor_username TEXT NOT NULL,
  action TEXT NOT NULL,
  account_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS linkedin_pool_audit_created
  ON linkedin_pool_audit(created_at DESC, id DESC);
`;

function normalizeLoginIdentifier(value: string): string {
  const trimmed = value.trim();
  // Email logins are case-insensitive. Preserve non-email identifiers exactly
  // as entered so the admin can recognize a provider-specific account label.
  return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function accountAssociatedData(accountId: string, field: string): string {
  return `linkedin-pool:${accountId}:${field}`;
}

function requireProviderMarkerForReady(probe: LinkedinProviderProbe | undefined): void {
  if (probe?.state === 'ready' && !probe.accountMarker?.trim()) {
    throw new LinkedinPoolConflictError('linkedin_provider_marker_required');
  }
}

function failureCodeForState(state: LinkedinSessionState): LinkedinFailureCode | null {
  switch (state) {
    case 'login_required':
      return 'login_required';
    case 'expired':
      return 'expired';
    case 'challenge_required':
      return 'challenge_required';
    case 'revoked':
      return 'revoked';
    case 'banned':
      return 'banned';
    default:
      return null;
  }
}

export class SqliteLinkedinPoolRepository {
  private readonly database: DatabaseSync;
  private readonly sealedText: SealedText;
  private readonly runtimeRoot: string;
  private readonly probe?: LinkedinSessionProbe;
  private readonly now: () => Date;

  constructor(options: LinkedinPoolRepositoryOptions) {
    if (options.databasePath !== ':memory:') {
      mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
    }
    this.database = new DatabaseSync(options.databasePath, {
      timeout: 5_000,
      enableForeignKeyConstraints: true,
      defensive: true,
    });
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(LINKEDIN_POOL_SCHEMA);
    this.sealedText = new SealedText(options.encryptionKey);
    this.runtimeRoot = options.runtimeRoot ?? join(tmpdir(), 'openqareer-linkedin-runtime');
    if (!isAbsolute(this.runtimeRoot)) {
      throw new Error('linkedin_runtime_root_must_be_absolute');
    }
    this.probe = options.probe;
    this.now = options.now ?? (() => new Date());
    this.purgeExpiredSessionCookies();
  }

  close(): void {
    this.database.close();
  }

  getDatabase(): DatabaseSync {
    return this.database;
  }

  list(input: LinkedinPoolListInput): LinkedinPoolPage {
    this.purgeExpiredSessionCookies();
    const where = input.state ? 'WHERE a.state = ?' : '';
    const stateParams = input.state ? [input.state] : [];
    const params = [...stateParams, input.limit, input.offset];
    const totalRow = this.database
      .prepare(`SELECT COUNT(*) AS total FROM linkedin_pool_accounts a ${where}`)
      .get(...stateParams) as { total: number };
    const rows = this.database
      .prepare(
        `SELECT a.*, s.captured_at AS session_captured_at,
            s.expires_at AS session_expires_at, s.cookie_count AS session_cookie_count,
            s.revision AS session_revision
         FROM linkedin_pool_accounts a
         LEFT JOIN linkedin_pool_sessions s ON s.account_id = a.id
         ${where}
         ORDER BY a.created_at DESC, a.id ASC LIMIT ? OFFSET ?`,
      )
      .all(...params) as unknown as AccountRow[];
    const accounts = rows.map((row) => this.toAccount(row));
    const nextOffset =
      input.offset + accounts.length < Number(totalRow.total)
        ? input.offset + accounts.length
        : null;
    return {
      total: Number(totalRow.total),
      accounts,
      offset: input.offset,
      nextOffset,
    };
  }

  storeSessionCookies(
    accountId: string,
    cookies: readonly LinkedinSessionCookie[],
    actor: LinkedinPoolActor,
  ): LinkedinPoolServerSessionSummary {
    const account = this.requireAccountRow(accountId);
    if (account.state !== 'ready') {
      throw new LinkedinPoolConflictError('linkedin_session_account_not_ready');
    }
    const prepared = this.prepareSessionCookies(cookies);
    const capturedAt = this.now().toISOString();
    const existing = this.database
      .prepare('SELECT revision FROM linkedin_pool_sessions WHERE account_id = ?')
      .get(accountId) as { revision: number } | undefined;
    const revision = (existing?.revision ?? 0) + 1;
    const cookiesCipher = this.sealedText.seal(
      JSON.stringify(prepared.cookies),
      accountAssociatedData(accountId, 'session-cookies'),
    );

    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO linkedin_pool_sessions
            (account_id, cookies_cipher, captured_at, expires_at, cookie_count, revision)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id) DO UPDATE SET
            cookies_cipher = excluded.cookies_cipher,
            captured_at = excluded.captured_at,
            expires_at = excluded.expires_at,
            cookie_count = excluded.cookie_count,
            revision = excluded.revision`,
        )
        .run(accountId, cookiesCipher, capturedAt, prepared.expiresAt, cookies.length, revision);
      this.recordAudit(
        actor,
        'server_session_stored',
        accountId,
        `Stored ${cookies.length} LinkedIn cookies; expires ${prepared.expiresAt}`,
      );
    });

    return {
      capturedAt,
      expiresAt: prepared.expiresAt,
      cookieCount: cookies.length,
      revision,
    };
  }

  /** Decrypted session material is available only to trusted server code. */
  readSessionCookies(accountId: string): readonly LinkedinSessionCookie[] | null {
    const account = this.requireAccountRow(accountId);
    if (account.state !== 'ready') return null;
    const row = this.database
      .prepare('SELECT cookies_cipher, expires_at FROM linkedin_pool_sessions WHERE account_id = ?')
      .get(accountId) as { cookies_cipher: string; expires_at: string } | undefined;
    if (!row) return null;
    if (Date.parse(row.expires_at) <= this.now().getTime()) {
      this.database
        .prepare('DELETE FROM linkedin_pool_sessions WHERE account_id = ? AND expires_at <= ?')
        .run(accountId, this.now().toISOString());
      return null;
    }
    const opened = this.sealedText.open(
      row.cookies_cipher,
      accountAssociatedData(accountId, 'session-cookies'),
    );
    const cookies: unknown = JSON.parse(opened);
    if (!Array.isArray(cookies)) throw new Error('linkedin_session_envelope_invalid');
    return cookies as LinkedinSessionCookie[];
  }

  deleteSessionCookies(accountId: string, actor: LinkedinPoolActor): boolean {
    this.requireAccountRow(accountId);
    let deleted = false;
    this.transaction(() => {
      deleted =
        Number(
          this.database
            .prepare('DELETE FROM linkedin_pool_sessions WHERE account_id = ?')
            .run(accountId).changes,
        ) > 0;
      this.recordAudit(
        actor,
        'server_session_deleted',
        accountId,
        deleted ? 'Stored LinkedIn session removed' : 'No stored LinkedIn session existed',
      );
    });
    return deleted;
  }

  private prepareSessionCookies(cookies: readonly LinkedinSessionCookie[]): {
    readonly cookies: readonly LinkedinSessionCookie[];
    readonly expiresAt: string;
  } {
    const prepared = prepareLinkedinSessionCookies(cookies, this.now());
    if (!prepared.ok) throw new LinkedinPoolConflictError(prepared.code);
    return { cookies: prepared.cookies, expiresAt: prepared.expiresAt };
  }

  purgeExpiredSessionCookies(): number {
    return Number(
      this.database
      .prepare('DELETE FROM linkedin_pool_sessions WHERE expires_at <= ?')
        .run(this.now().toISOString()).changes,
    );
  }

  // This method intentionally keeps idempotency, encrypted row construction
  // and the audit write in one reviewable transaction boundary.
  // eslint-disable-next-line max-lines-per-function
  create(input: LinkedinPoolCreateInput): { account: LinkedinPoolAccount; created: boolean } {
    const emailLogin = normalizeLoginIdentifier(input.emailLogin);
    const requestDigest = digest(
      JSON.stringify({
        adminLabel: input.adminLabel,
        emailLogin,
        providerAccountMarker: input.providerAccountMarker ?? null,
      }),
    );
    const previous = this.database
      .prepare(
        'SELECT request_digest, account_id FROM linkedin_pool_idempotency WHERE idempotency_key = ?',
      )
      .get(input.idempotencyKey) as { request_digest: string; account_id: string } | undefined;
    if (previous) {
      if (previous.request_digest !== requestDigest) {
        throw new LinkedinPoolConflictError('idempotency_key_reused');
      }
      const account = this.findAccount(previous.account_id);
      if (!account) throw new LinkedinPoolConflictError('idempotency_record_expired');
      return { account, created: false };
    }
    const emailDigest = digest(emailLogin);
    const duplicate = this.database
      .prepare('SELECT 1 FROM linkedin_pool_accounts WHERE email_login_digest = ?')
      .get(emailDigest);
    if (duplicate) throw new LinkedinPoolConflictError('linkedin_email_login_exists');

    const id = randomUUID();
    const profileIsolationId = `profile_${randomUUID()}`;
    const now = this.now().toISOString();
    const account: AccountRow = {
      id,
      admin_label: input.adminLabel.trim(),
      email_login_cipher: this.sealedText.seal(emailLogin, accountAssociatedData(id, 'email')),
      email_login_digest: emailDigest,
      provider_marker_cipher: input.providerAccountMarker
        ? this.sealedText.seal(
            input.providerAccountMarker.trim(),
            accountAssociatedData(id, 'provider-marker'),
          )
        : null,
      profile_isolation_id: profileIsolationId,
      state: 'unconfigured',
      last_verified_at: null,
      last_heartbeat_at: null,
      last_failure_code: 'account_unconfigured',
      lease_until: null,
      capability_verdict: 'not_configured',
      revision: 0,
      created_at: now,
      updated_at: now,
    };
    mkdirSync(join(this.runtimeRoot, profileIsolationId), { recursive: true, mode: 0o700 });
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO linkedin_pool_accounts (
            id, admin_label, email_login_cipher, email_login_digest,
            provider_marker_cipher, profile_isolation_id, state,
            last_failure_code, capability_verdict, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          account.id,
          account.admin_label,
          account.email_login_cipher,
          account.email_login_digest,
          account.provider_marker_cipher,
          account.profile_isolation_id,
          account.state,
          account.last_failure_code,
          account.capability_verdict,
          account.revision,
          account.created_at,
          account.updated_at,
        );
      this.database
        .prepare(
          `INSERT INTO linkedin_pool_idempotency
            (idempotency_key, request_digest, account_id, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(input.idempotencyKey, requestDigest, account.id, now);
      this.recordAudit(input, 'account_created', account.id, 'Pool account created');
    });
    return { account: this.toAccount(account), created: true };
  }

  update(input: LinkedinPoolUpdateInput): LinkedinPoolAccount {
    const current = this.requireAccountRow(input.accountId);
    this.assertRevision(current, input.revision);
    const nextEmail =
      input.emailLogin === undefined
        ? this.openEmail(current)
        : normalizeLoginIdentifier(input.emailLogin);
    const nextMarker =
      input.providerAccountMarker === undefined
        ? this.openMarker(current)
        : input.providerAccountMarker?.trim() || null;
    if (nextEmail !== this.openEmail(current)) {
      const duplicate = this.database
        .prepare('SELECT 1 FROM linkedin_pool_accounts WHERE email_login_digest = ? AND id <> ?')
        .get(digest(nextEmail), input.accountId);
      if (duplicate) throw new LinkedinPoolConflictError('linkedin_email_login_exists');
    }
    const now = this.now().toISOString();
    this.database
      .prepare(
        `UPDATE linkedin_pool_accounts SET
          admin_label = ?, email_login_cipher = ?, email_login_digest = ?,
          provider_marker_cipher = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
      )
      .run(
        input.adminLabel?.trim() || current.admin_label,
        this.sealedText.seal(nextEmail, accountAssociatedData(input.accountId, 'email')),
        digest(nextEmail),
        nextMarker
          ? this.sealedText.seal(
              nextMarker,
              accountAssociatedData(input.accountId, 'provider-marker'),
            )
          : null,
        now,
        input.accountId,
        input.revision,
      );
    this.recordAudit(input, 'account_updated', input.accountId, 'Pool account metadata updated');
    return this.requireAccount(input.accountId);
  }

  async beginLogin(
    accountId: string,
    actor: LinkedinPoolActor,
  ): Promise<{
    account: LinkedinPoolAccount;
    lease: LinkedinLease;
  }> {
    const current = this.requireAccountRow(accountId);
    if (current.state === 'disabled') {
      throw new LinkedinPoolConflictError('linkedin_account_disabled');
    }
    if (current.state === 'banned') {
      throw new LinkedinPoolConflictError('linkedin_account_banned');
    }
    const nextState: LinkedinSessionState = 'user_action_required';
    assertTransition(current.state, nextState);
    const now = this.now();
    const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
    const rawHandle = `lhs_${randomBytes(32).toString('base64url')}`;
    const nowIso = now.toISOString();
    this.transaction(() => {
      this.database.prepare('DELETE FROM linkedin_pool_leases WHERE account_id = ?').run(accountId);
      this.database
        .prepare(
          `INSERT INTO linkedin_pool_leases
            (id, account_id, token_hash, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), accountId, digest(rawHandle), expiresAt, nowIso);
      this.database
        .prepare(
          `UPDATE linkedin_pool_accounts SET state = ?, last_failure_code = NULL,
            lease_until = ?, revision = revision + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(nextState, expiresAt, nowIso, accountId);
      this.recordAudit(actor, 'login_requested', accountId, 'Manual desktop login requested');
    });
    return {
      account: this.requireAccount(accountId),
      lease: {
        accountId,
        handle: rawHandle,
        expiresAt,
        transport: 'desktop',
        webRemote: false,
      },
    };
  }

  async completeLogin(
    accountId: string,
    handle: string,
    providerProbe?: LinkedinProviderProbe,
  ): Promise<LinkedinPoolAccount> {
    requireProviderMarkerForReady(providerProbe);
    const lease = this.findLoginLease(accountId, handle);
    if (!lease || Date.parse(lease.expires_at) <= this.now().getTime()) {
      throw new LinkedinPoolConflictError('linkedin_login_lease_expired');
    }
    const current = this.requireAccountRow(accountId);
    assertTransition(current.state, 'checking');
    const now = this.now().toISOString();
    this.database
      .prepare(
        `UPDATE linkedin_pool_accounts SET state = 'checking', last_failure_code = NULL,
          last_heartbeat_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?`,
      )
      .run(now, now, accountId);
    const account = this.requireAccount(accountId);
    this.database
      .prepare('UPDATE linkedin_pool_leases SET consumed_at = ? WHERE token_hash = ?')
      .run(now, lease.token_hash);
    if (providerProbe) {
      return this.applyProbe(accountId, providerProbe);
    }
    if (!this.probe) {
      return this.finishWithoutRuntime(accountId, 'session_runtime_unavailable');
    }
    let probe: LinkedinProviderProbe;
    try {
      probe = await this.probe({
        account,
        lease: {
          accountId,
          handle,
          expiresAt: lease.expires_at,
          transport: 'desktop',
          webRemote: false,
        },
      });
    } catch {
      return this.finishWithoutRuntime(accountId, 'provider_probe_failed');
    }
    return this.applyProbe(accountId, probe);
  }

  async probeAccount(accountId: string, actor: LinkedinPoolActor): Promise<LinkedinPoolAccount> {
    const current = this.requireAccountRow(accountId);
    assertTransition(current.state, 'checking');
    const now = this.now().toISOString();
    this.database
      .prepare(
        `UPDATE linkedin_pool_accounts SET state = 'checking', last_failure_code = NULL,
          last_heartbeat_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?`,
      )
      .run(now, now, accountId);
    this.recordAudit(actor, 'status_probe_requested', accountId, 'Session status probe requested');
    if (!this.probe) return this.finishWithoutRuntime(accountId, 'provider_probe_unavailable');
    let probe: LinkedinProviderProbe;
    try {
      probe = await this.probe({ account: this.requireAccount(accountId) });
    } catch {
      return this.finishWithoutRuntime(accountId, 'provider_probe_failed');
    }
    return this.applyProbe(accountId, probe);
  }

  revoke(accountId: string, actor: LinkedinPoolActor): LinkedinPoolAccount {
    const current = this.requireAccountRow(accountId);
    assertTransition(current.state, 'revoked');
    const now = this.now().toISOString();
    this.transaction(() => {
      this.database.prepare('DELETE FROM linkedin_pool_leases WHERE account_id = ?').run(accountId);
      this.database
        .prepare('DELETE FROM linkedin_pool_sessions WHERE account_id = ?')
        .run(accountId);
      this.database
        .prepare(
          `UPDATE linkedin_pool_accounts SET state = 'revoked', last_failure_code = 'revoked',
            lease_until = NULL, revision = revision + 1, updated_at = ? WHERE id = ?`,
        )
        .run(now, accountId);
      this.recordAudit(actor, 'session_revoked', accountId, 'Session revoked');
    });
    return this.requireAccount(accountId);
  }

  delete(accountId: string, revision: number, actor: LinkedinPoolActor): void {
    const current = this.requireAccountRow(accountId);
    this.assertRevision(current, revision);
    this.transaction(() => {
      this.recordAudit(actor, 'account_deleted', accountId, 'Pool account deleted');
      this.database.prepare('DELETE FROM linkedin_pool_accounts WHERE id = ?').run(accountId);
    });
    rmSync(join(this.runtimeRoot, current.profile_isolation_id), { recursive: true, force: true });
  }

  private applyProbe(accountId: string, probe: LinkedinProviderProbe): LinkedinPoolAccount {
    const current = this.requireAccountRow(accountId);
    if (probe.state === 'ready') {
      const expectedMarker = this.openMarker(current);
      if (
        !probe.accountMarker?.trim() ||
        (expectedMarker && expectedMarker !== probe.accountMarker)
      ) {
        return this.finishWithoutRuntime(accountId, 'provider_probe_failed');
      }
    }
    assertTransition(current.state, probe.state);
    const now = this.now().toISOString();
    const lastVerifiedAt =
      probe.state === 'ready' ? (probe.verifiedAt ?? now) : current.last_verified_at;
    const failureCode = probe.failureCode ?? failureCodeForState(probe.state);
    const markerCipher = probe.accountMarker
      ? this.sealedText.seal(
          probe.accountMarker,
          accountAssociatedData(accountId, 'provider-marker'),
        )
      : current.provider_marker_cipher;
    this.transaction(() => {
      this.database
        .prepare(
          `UPDATE linkedin_pool_accounts SET state = ?, provider_marker_cipher = ?,
            last_verified_at = ?, last_heartbeat_at = ?, last_failure_code = ?,
            lease_until = NULL, revision = revision + 1, updated_at = ? WHERE id = ?`,
        )
        .run(probe.state, markerCipher, lastVerifiedAt, now, failureCode, now, accountId);
      if (probe.state !== 'ready') {
        this.database
          .prepare('DELETE FROM linkedin_pool_sessions WHERE account_id = ?')
          .run(accountId);
      }
    });
    return this.requireAccount(accountId);
  }

  private finishWithoutRuntime(
    accountId: string,
    failureCode: Extract<
      LinkedinFailureCode,
      'session_runtime_unavailable' | 'provider_probe_unavailable' | 'provider_probe_failed'
    >,
  ): LinkedinPoolAccount {
    const current = this.requireAccountRow(accountId);
    const target = current.state === 'checking' ? 'login_required' : current.state;
    if (target !== current.state) assertTransition(current.state, target);
    const now = this.now().toISOString();
    this.database
      .prepare(
        `UPDATE linkedin_pool_accounts SET state = ?, last_failure_code = ?,
          last_heartbeat_at = ?, lease_until = NULL, revision = revision + 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(target, failureCode, now, now, accountId);
    return this.requireAccount(accountId);
  }

  private findAccount(accountId: string): LinkedinPoolAccount | null {
    const row = this.database
      .prepare('SELECT * FROM linkedin_pool_accounts WHERE id = ?')
      .get(accountId) as AccountRow | undefined;
    return row ? this.toAccount(row) : null;
  }

  private requireAccount(accountId: string): LinkedinPoolAccount {
    const account = this.findAccount(accountId);
    if (!account) throw new LinkedinPoolNotFoundError();
    return account;
  }

  private requireAccountRow(accountId: string): AccountRow {
    const row = this.database
      .prepare('SELECT * FROM linkedin_pool_accounts WHERE id = ?')
      .get(accountId) as AccountRow | undefined;
    if (!row) throw new LinkedinPoolNotFoundError();
    return row;
  }

  private findLoginLease(accountId: string, handle: string): LeaseRow | undefined {
    return this.database
      .prepare(
        `SELECT account_id, token_hash, expires_at FROM linkedin_pool_leases
         WHERE account_id = ? AND token_hash = ? AND consumed_at IS NULL`,
      )
      .get(accountId, digest(handle)) as LeaseRow | undefined;
  }

  private assertRevision(row: AccountRow, revision: number): void {
    if (row.revision !== revision) throw new LinkedinPoolConflictError('stale_revision');
  }

  private openEmail(row: AccountRow): string {
    return this.sealedText.open(row.email_login_cipher, accountAssociatedData(row.id, 'email'));
  }

  private openMarker(row: AccountRow): string | null {
    if (!row.provider_marker_cipher) return null;
    return this.sealedText.open(
      row.provider_marker_cipher,
      accountAssociatedData(row.id, 'provider-marker'),
    );
  }

  private toAccount(row: AccountRow): LinkedinPoolAccount {
    return {
      id: row.id,
      adminLabel: row.admin_label,
      emailLogin: this.openEmail(row),
      providerAccountMarker: this.openMarker(row),
      profileIsolationId: row.profile_isolation_id,
      state: row.state,
      lastVerifiedAt: row.last_verified_at,
      lastHeartbeatAt: row.last_heartbeat_at,
      lastFailureCode: row.last_failure_code,
      leaseUntil: row.lease_until,
      capabilityVerdict: row.capability_verdict,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      serverSession:
        row.session_captured_at &&
        row.session_expires_at &&
        typeof row.session_cookie_count === 'number' &&
        typeof row.session_revision === 'number'
          ? {
              capturedAt: row.session_captured_at,
              expiresAt: row.session_expires_at,
              cookieCount: row.session_cookie_count,
              revision: row.session_revision,
            }
          : null,
    };
  }

  private recordAudit(
    actor: LinkedinPoolActor,
    action: string,
    accountId: string | null,
    detail: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO linkedin_pool_audit
          (id, actor_user_id, actor_username, action, account_id, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        actor.actorUserId,
        actor.actorUsername,
        action,
        accountId,
        detail,
        this.now().toISOString(),
      );
  }

  private transaction(operation: () => void): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      operation();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
