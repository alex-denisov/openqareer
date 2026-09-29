export const LINKEDIN_SESSION_STATES = [
  'unconfigured',
  'login_required',
  'user_action_required',
  'checking',
  'ready',
  'expired',
  'challenge_required',
  'cooling_down',
  'revoked',
  'banned',
  'disabled',
] as const;

export type LinkedinSessionState = (typeof LINKEDIN_SESSION_STATES)[number];

export const LINKEDIN_PROVIDER_CAPABILITIES = [
  'not_configured',
  'official_api',
  'provider_permitted',
] as const;

export type LinkedinProviderCapability = (typeof LINKEDIN_PROVIDER_CAPABILITIES)[number];

export const LINKEDIN_FAILURE_CODES = [
  'account_unconfigured',
  'login_required',
  'session_runtime_unavailable',
  'provider_permission_required',
  'provider_probe_unavailable',
  'provider_probe_failed',
  'challenge_required',
  'expired',
  'revoked',
  'banned',
  'lease_conflict',
  'stale_revision',
] as const;

export type LinkedinFailureCode = (typeof LINKEDIN_FAILURE_CODES)[number];

export type LinkedinSessionCookieSameSite = 'Strict' | 'Lax' | 'None';

/** Cookie values are process-only data and must never enter the account DTO. */
export interface LinkedinSessionCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  /** Unix seconds; null means a browser session cookie without an expiry. */
  readonly expiresAt: number | null;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: LinkedinSessionCookieSameSite | null;
}

export interface LinkedinPoolServerSessionSummary {
  readonly capturedAt: string;
  readonly expiresAt: string;
  readonly cookieCount: number;
  readonly revision: number;
}

export function isLinkedinSessionCookieDomain(value: string): boolean {
  const rawDomain = value.trim().toLowerCase();
  const domain = rawDomain.startsWith('.') ? rawDomain.slice(1) : rawDomain;
  return (
    domain === 'linkedin.com' ||
    domain.endsWith('.linkedin.com') ||
    domain === 'linkedin.cn' ||
    domain.endsWith('.linkedin.cn')
  );
}

export interface LinkedinPoolAccount {
  readonly id: string;
  readonly adminLabel: string;
  readonly emailLogin: string;
  readonly providerAccountMarker: string | null;
  readonly profileIsolationId: string;
  readonly state: LinkedinSessionState;
  readonly lastVerifiedAt: string | null;
  readonly lastHeartbeatAt: string | null;
  readonly lastFailureCode: LinkedinFailureCode | null;
  readonly leaseUntil: string | null;
  readonly capabilityVerdict: LinkedinProviderCapability;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly serverSession: LinkedinPoolServerSessionSummary | null;
}

export interface LinkedinPoolPage {
  readonly total: number;
  readonly accounts: readonly LinkedinPoolAccount[];
  readonly offset: number;
  readonly nextOffset: number | null;
}

export interface LinkedinLease {
  readonly accountId: string;
  readonly handle: string;
  readonly expiresAt: string;
  readonly transport: 'desktop';
  readonly webRemote: false;
}

export interface LinkedinProviderProbe {
  readonly state: Extract<
    LinkedinSessionState,
    'ready' | 'expired' | 'challenge_required' | 'banned' | 'login_required'
  >;
  readonly accountMarker?: string;
  readonly failureCode?: LinkedinFailureCode;
  readonly verifiedAt?: string;
}

const ALLOWED_TRANSITIONS: Record<LinkedinSessionState, readonly LinkedinSessionState[]> = {
  unconfigured: ['login_required', 'user_action_required', 'revoked', 'disabled'],
  login_required: ['user_action_required', 'disabled'],
  user_action_required: ['checking', 'login_required', 'revoked', 'disabled'],
  checking: [
    'ready',
    'user_action_required',
    'expired',
    'challenge_required',
    'login_required',
    'banned',
    'revoked',
    'disabled',
  ],
  ready: [
    'checking',
    'user_action_required',
    'expired',
    'challenge_required',
    'cooling_down',
    'revoked',
    'disabled',
  ],
  expired: ['user_action_required', 'login_required', 'revoked', 'disabled'],
  challenge_required: ['user_action_required', 'login_required', 'revoked', 'disabled'],
  cooling_down: ['checking', 'ready', 'login_required', 'revoked', 'disabled'],
  revoked: ['user_action_required', 'login_required', 'disabled'],
  banned: ['disabled'],
  disabled: [],
};

export function canTransition(from: LinkedinSessionState, to: LinkedinSessionState): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: LinkedinSessionState, to: LinkedinSessionState): void {
  if (!canTransition(from, to)) {
    throw new Error(`linkedin_session_transition_not_allowed:${from}->${to}`);
  }
}
