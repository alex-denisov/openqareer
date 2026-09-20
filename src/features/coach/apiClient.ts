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
/**
 * Истёкшая сессия — событие для всего приложения, не для экрана, который
 * первым получил `401` (PRB-038). App слушает его и уводит на вход один раз.
 */
export const SESSION_EXPIRED_EVENT = 'openqareer:session-expired';
export const API_READ_TIMEOUT_MS = 20_000;

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
  const method = (init.method ?? 'GET').toUpperCase();
  const signal = init.signal ?? (
    method === 'GET' || method === 'HEAD' ? AbortSignal.timeout(API_READ_TIMEOUT_MS) : undefined
  );
  if (signal?.aborted) throw networkError();

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
      const body = typeof init.body === 'string' ? init.body : undefined;
      const nativeRequest = desktopNativeFetch({ url: fullUrl, method, headers, body });
      const nativeRes = await raceWithAbort(nativeRequest, signal);

      if (nativeRes) {
        // Fetch forbids a body on these statuses, including an empty string.
        // Throwing here used to replay successful logout/deletion in WebKit.
        return new Response([204, 205, 304].includes(nativeRes.status) ? null : nativeRes.body, {
          status: nativeRes.status,
          statusText: nativeRes.ok ? 'OK' : 'Error',
          headers: new Headers(nativeRes.headers),
        });
      }
    } catch {
      throw networkError();
    }
    // A native failure is not permission to replay a potentially completed
    // mutation using a second transport. Keep the saved session for recovery.
    throw networkError();
  }

  try {
    return await fetch(fullUrl, {
      ...init,
      credentials: 'include',
      headers,
      signal,
    });
  } catch {
    throw networkError();
  }
}

function networkError(): CoachApiError {
  return new CoachApiError(
    'Не удалось связаться с сервисом. Проверьте соединение и повторите.',
    'network_error',
    true,
  );
}

/** Tauri IPC has no AbortSignal parameter; race it so a hung native request
 * cannot keep the desktop shell in its session gate forever. */
function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export async function readData<T>(response: Response): Promise<T> {
  if (!response.ok) {
    await throwApiError(response);
  }
  const envelope = await readEnvelope<T>(response);
  const data = envelope.data;
  if (data && typeof data === 'object' && 'sessionToken' in data) {
    const token = (data as { sessionToken?: unknown }).sessionToken;
    if (typeof token === 'string' && token) {
      setStoredSessionToken(token);
    }
  }
  return data;
}

/**
 * A body that is not JSON is a malformed response, not a defect the candidate
 * can read about. WebKit — the engine the desktop app runs on — rejects one
 * with `SyntaxError: The string did not match the expected pattern.`, and that
 * sentence used to be printed in the cabinet header verbatim (INC-027).
 */
async function readEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  try {
    return (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw malformedResponseError();
  }
}

/**
 * The one sentence a surface may show for a failed reading.
 *
 * Only a `CoachApiError` carries a message written for a candidate. Anything
 * else is an engine or programming failure whose text is English, technical
 * and untranslatable — printing it verbatim is how
 * `The string did not match the expected pattern.` reached the cabinet header
 * (INC-027). The original is kept on the returned error for diagnosis.
 */
export function apiErrorMessage(reason: unknown, fallback: string): string {
  return reason instanceof CoachApiError ? reason.message : fallback;
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
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  throw new CoachApiError(
    envelope.error?.message ?? 'Сервис не завершил действие. Попробуйте ещё раз.',
    envelope.error?.code ?? `http_${response.status}`,
    envelope.error?.retryable ?? response.status >= 500,
    envelope.error?.fields ?? {},
  );
}
