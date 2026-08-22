import {
  desktopNativeFetch,
  isTauriEnvironment,
} from '../../services/desktop/desktopBridge';

/**
 * The shared browser transport for the candidate API.
 *
 * Extracted from `coachApi.ts` so a new surface can talk to its own endpoints
 * without growing that module past the file-size budget, and so every caller
 * keeps the same envelope, credential and error-narrowing behaviour.
 */
interface ApiEnvelope<T> {
  data: T;
}

interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    fields?: Record<string, string>;
  };
}

export class CoachApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    /** Per-field messages, when the server rejected specific form fields. */
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'CoachApiError';
  }
}

export const SESSION_TOKEN_STORAGE_KEY = 'openqareer_session_token';

export function getStoredSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore localStorage access failures
  }
}

export function getApiBaseUrl(): string {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    // Tauri (tauri://), custom asset protocols (asset://), file, or non-http protocols target the remote backend
    if (
      !origin ||
      origin.startsWith('tauri://') ||
      origin.startsWith('asset://') ||
      origin.startsWith('file://') ||
      origin === 'null' ||
      !origin.startsWith('http')
    ) {
      return 'https://openqareer.com';
    }
  }
  return '';
}

export async function apiFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const baseUrl = getApiBaseUrl();
  const fullUrl = input.startsWith('http') ? input : `${baseUrl}${input}`;
  const token = getStoredSessionToken();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.headers as Record<string, string>),
  };

  if (token && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  // If in desktop Tauri environment, perform native request via Rust to bypass browser CORS & preflights
  if (isTauriEnvironment() && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? init.body : undefined;
      const nativeRes = await desktopNativeFetch({
        url: fullUrl,
        method,
        headers,
        body,
      });

      if (nativeRes) {
        return new Response(nativeRes.body, {
          status: nativeRes.status,
          statusText: nativeRes.ok ? 'OK' : 'Error',
          headers: new Headers(nativeRes.headers),
        });
      }
    } catch {
      // Fallback to browser fetch below
    }
  }

  try {
    return await fetch(fullUrl, {
      ...init,
      credentials: 'include',
      headers,
    });
  } catch {
    throw new CoachApiError(
      'Не удалось связаться с сервисом. Проверьте соединение и повторите.',
      'network_error',
      true,
    );
  }
}

export async function readData<T>(response: Response): Promise<T> {
  if (!response.ok) {
    await throwApiError(response);
  }
  const envelope = (await response.json()) as ApiEnvelope<T>;
  const data = envelope.data;
  if (data && typeof data === 'object' && 'sessionToken' in data) {
    const token = (data as { sessionToken?: unknown }).sessionToken;
    if (typeof token === 'string' && token) {
      setStoredSessionToken(token);
    }
  }
  return data;
}

const MALFORMED_RESPONSE_MESSAGE =
  'Сервис вернул ответ неожиданной формы. Повторите запрос.';

function malformedResponseError(): CoachApiError {
  return new CoachApiError(MALFORMED_RESPONSE_MESSAGE, 'malformed_response', true);
}

/**
 * INC-020: an endpoint whose contract is a non-null object or array must not
 * hand `null` to render code typed as `T`. Unexpected shapes become a typed,
 * retryable API error at the boundary instead of an exception in a component.
 */
export async function readDataObject<T extends object>(response: Response): Promise<T> {
  const data = await readData<T>(response);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw malformedResponseError();
  }
  return data;
}

export async function readDataArray<T>(response: Response): Promise<T[]> {
  const data = await readData<unknown>(response);
  if (!Array.isArray(data)) {
    throw malformedResponseError();
  }
  return data as T[];
}

export async function throwApiError(response: Response): Promise<never> {
  let envelope: ApiErrorEnvelope = {};
  try {
    envelope = (await response.json()) as ApiErrorEnvelope;
  } catch {
    // The stable fallback below intentionally ignores untrusted response text.
  }
  throw new CoachApiError(
    envelope.error?.message ?? 'Сервис не завершил действие. Попробуйте ещё раз.',
    envelope.error?.code ?? `http_${response.status}`,
    envelope.error?.retryable ?? response.status >= 500,
    envelope.error?.fields ?? {},
  );
}
