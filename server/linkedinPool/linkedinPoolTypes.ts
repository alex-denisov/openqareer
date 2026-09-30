import type {
  LinkedinFailureCode,
  LinkedinLease,
  LinkedinPoolAccount,
  LinkedinProviderCapability,
  LinkedinProviderProbe,
  LinkedinSessionState,
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
  readonly timezone?: string;
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
  readonly timezone?: string | null;
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

export interface AccountRow {
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
  timezone: string;
  revision: number;
  created_at: string;
  updated_at: string;
  session_captured_at?: string | null;
  session_expires_at?: string | null;
  session_cookie_count?: number | null;
  session_revision?: number | null;
}

export interface LeaseRow {
  account_id: string;
  token_hash: string;
  expires_at: string;
}

export const LINKEDIN_POOL_SCHEMA = `
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
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
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
