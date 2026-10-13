import { apiFetch, readData, readDataObject } from '../coach/apiClient';
import type { AuthUser } from '../coach/coachApi';

export interface PendingAccountEmailChange {
  readonly email: string;
  readonly expiresAt: string;
  readonly resendAfterSeconds: number;
}

export type AccountEmailChangeResult =
  | {
      readonly status: 'pending';
      readonly email: string;
      readonly expiresAt: string;
      readonly resendAfterSeconds: number;
      readonly emailVerificationEmailSent: true;
    }
  | ({ readonly status: 'updated' } & AuthUser);

export async function requestAccountEmailChange(input: {
  readonly email: string;
  readonly currentPassword: string;
}): Promise<AccountEmailChangeResult> {
  const response = await apiFetch('/api/v1/account/email-change-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readDataObject<AccountEmailChangeResult>(response);
}

export async function getPendingAccountEmailChange(): Promise<PendingAccountEmailChange | null> {
  const response = await apiFetch('/api/v1/account/email-change-requests/current', { cache: 'no-store' });
  return readData<PendingAccountEmailChange | null>(response);
}

export async function verifyAccountEmailChange(code: string): Promise<AuthUser> {
  const response = await apiFetch('/api/v1/account/email-change-requests/current/verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return readDataObject<AuthUser>(response);
}
