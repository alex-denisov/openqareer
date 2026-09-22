import { apiFetch, readData, throwApiError } from '../coach/apiClient';

export type LinkedinSessionState =
  | 'unconfigured'
  | 'login_required'
  | 'user_action_required'
  | 'checking'
  | 'ready'
  | 'expired'
  | 'challenge_required'
  | 'cooling_down'
  | 'revoked'
  | 'banned'
  | 'disabled';

export type LinkedinFailureCode =
  | 'account_unconfigured'
  | 'login_required'
  | 'session_runtime_unavailable'
  | 'provider_permission_required'
  | 'provider_probe_unavailable'
  | 'provider_probe_failed'
  | 'challenge_required'
  | 'expired'
  | 'revoked'
  | 'banned'
  | 'lease_conflict'
  | 'stale_revision';

export interface LinkedinPoolAccount {
  id: string;
  adminLabel: string;
  emailLogin: string;
  providerAccountMarker: string | null;
  profileIsolationId: string;
  state: LinkedinSessionState;
  lastVerifiedAt: string | null;
  lastHeartbeatAt: string | null;
  lastFailureCode: LinkedinFailureCode | null;
  leaseUntil: string | null;
  capabilityVerdict: 'not_configured' | 'official_api' | 'provider_permitted';
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface LinkedinPoolPage {
  total: number;
  accounts: LinkedinPoolAccount[];
  offset: number;
  nextOffset: number | null;
}

export interface LinkedinLoginLease {
  accountId: string;
  handle: string;
  expiresAt: string;
  transport: 'desktop';
  webRemote: false;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function listAdminLinkedinAccounts(input?: {
  state?: LinkedinSessionState;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<LinkedinPoolPage> {
  const params = new URLSearchParams({
    limit: String(input?.limit ?? 25),
    offset: String(input?.offset ?? 0),
  });
  if (input?.state) params.set('state', input.state);
  const response = await apiFetch(`/api/v1/admin/linkedin/accounts?${params.toString()}`, {
    ...(input?.signal ? { signal: input.signal } : {}),
  });
  return readData<LinkedinPoolPage>(response);
}

export async function createAdminLinkedinAccount(input: {
  adminLabel: string;
  emailLogin: string;
  providerAccountMarker?: string;
}): Promise<LinkedinPoolAccount> {
  const response = await apiFetch('/api/v1/admin/linkedin/accounts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': newIdempotencyKey(),
    },
    body: JSON.stringify(input),
  });
  return readData<LinkedinPoolAccount>(response);
}

export async function updateAdminLinkedinAccount(
  accountId: string,
  input: {
    revision: number;
    adminLabel?: string;
    emailLogin?: string;
    providerAccountMarker?: string | null;
  },
): Promise<LinkedinPoolAccount> {
  const response = await apiFetch(`/api/v1/admin/linkedin/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readData<LinkedinPoolAccount>(response);
}

export async function requestAdminLinkedinLogin(accountId: string): Promise<{
  account: LinkedinPoolAccount;
  lease: LinkedinLoginLease;
}> {
  const response = await apiFetch(`/api/v1/admin/linkedin/accounts/${encodeURIComponent(accountId)}/session`, {
    method: 'POST',
  });
  return readData<{ account: LinkedinPoolAccount; lease: LinkedinLoginLease }>(response);
}

export async function completeAdminLinkedinLogin(
  accountId: string,
  handle: string,
): Promise<LinkedinPoolAccount> {
  const response = await apiFetch(`/api/v1/admin/linkedin/accounts/${encodeURIComponent(accountId)}/session/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle }),
  });
  return readData<LinkedinPoolAccount>(response);
}

export async function probeAdminLinkedinAccount(accountId: string): Promise<LinkedinPoolAccount> {
  const response = await apiFetch(`/api/v1/admin/linkedin/accounts/${encodeURIComponent(accountId)}/probe`, {
    method: 'POST',
  });
  return readData<LinkedinPoolAccount>(response);
}

export async function revokeAdminLinkedinAccount(accountId: string): Promise<LinkedinPoolAccount> {
  const response = await apiFetch(`/api/v1/admin/linkedin/accounts/${encodeURIComponent(accountId)}/revoke`, {
    method: 'POST',
  });
  return readData<LinkedinPoolAccount>(response);
}

export async function deleteAdminLinkedinAccount(accountId: string, revision: number): Promise<void> {
  const response = await apiFetch(`/api/v1/admin/linkedin/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision }),
  });
  if (!response.ok) await throwApiError(response);
}
