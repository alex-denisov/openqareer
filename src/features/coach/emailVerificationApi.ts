import { apiFetch, readDataObject } from './apiClient';
import type { AuthUser } from './coachApi';

export async function verifyEmailCode(code: string): Promise<AuthUser> {
  const response = await apiFetch('/api/v1/auth/email-verification/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return readDataObject<AuthUser>(response);
}

export async function resendEmailVerification(): Promise<AuthUser> {
  const response = await apiFetch('/api/v1/auth/email-verification/resend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return readDataObject<AuthUser>(response);
}

export async function changeUnverifiedEmail(input: {
  email: string;
  currentPassword: string;
}): Promise<AuthUser> {
  const response = await apiFetch('/api/v1/auth/email-verification/address', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readDataObject<AuthUser>(response);
}
