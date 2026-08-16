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

export async function apiFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
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
  return envelope.data;
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
