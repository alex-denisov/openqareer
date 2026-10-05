import { apiFetch, readData, throwApiError } from '../coach/apiClient';

export type RemoteLoginState = 'login' | 'checkpoint' | 'signed_in' | 'closed';
export type RemoteLoginReason = 'closed_by_admin' | 'idle' | 'persist_failed' | 'shutdown';
export type RemoteLoginKey =
  | 'Enter'
  | 'Tab'
  | 'Backspace'
  | 'Escape'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight';

export interface RemoteLoginFrame {
  state: RemoteLoginState;
  url: string;
  imageBase64: string | null;
  width: number;
  height: number;
  capturedAt: string;
  reason: RemoteLoginReason | null;
}

export type RemoteLoginInput =
  | { type: 'click'; x: number; y: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: RemoteLoginKey };

function baseUrl(accountId: string): string {
  return `/api/v1/admin/linkedin/accounts/${encodeURIComponent(accountId)}/remote-login`;
}

function loginUrl(accountId: string, loginId: string): string {
  return `${baseUrl(accountId)}/${encodeURIComponent(loginId)}`;
}

export async function startRemoteLogin(accountId: string): Promise<string> {
  const response = await apiFetch(baseUrl(accountId), { method: 'POST' });
  const data = await readData<{ loginId?: unknown }>(response);
  if (!data || typeof data.loginId !== 'string' || !data.loginId) {
    throw new Error('remote_login_malformed');
  }
  return data.loginId;
}

export async function fetchRemoteLoginFrame(
  accountId: string,
  loginId: string,
  signal?: AbortSignal,
): Promise<RemoteLoginFrame> {
  const response = await apiFetch(`${loginUrl(accountId, loginId)}/frame`, {
    ...(signal ? { signal } : {}),
  });
  return readData<RemoteLoginFrame>(response);
}

export async function sendRemoteLoginInput(
  accountId: string,
  loginId: string,
  input: RemoteLoginInput,
): Promise<void> {
  const response = await apiFetch(`${loginUrl(accountId, loginId)}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) await throwApiError(response);
}

export async function closeRemoteLogin(accountId: string, loginId: string): Promise<void> {
  const response = await apiFetch(loginUrl(accountId, loginId), { method: 'DELETE' });
  if (!response.ok) await throwApiError(response);
}
