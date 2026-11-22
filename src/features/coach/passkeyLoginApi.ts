import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { z } from 'zod';
import {
  apiFetch,
  getClientDeviceId,
  malformedResponseError,
  readData,
  readDataObject,
} from './apiClient';
import type { AuthUser } from './coachApi';

/** B755: вход ключом доступа — параметры и проверка; параметры отдаются вместе с токеном вызова. */
const challengeSchema = z.object({
  options: z.object({ challenge: z.string().min(1) }).loose(),
  token: z.string().min(1),
});

const REQUEST_TIMEOUT_MS = 8_000;

export interface PasskeyChallenge<T> {
  readonly options: T;
  readonly token: string;
}

export function parseChallenge<T>(data: unknown): PasskeyChallenge<T> {
  const parsed = challengeSchema.safeParse(data);
  if (!parsed.success) throw malformedResponseError();
  return { options: parsed.data.options as unknown as T, token: parsed.data.token };
}

export function postJson(url: string, body: object, signal?: AbortSignal): Promise<Response> {
  const deviceId = getClientDeviceId();
  return apiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(deviceId ? { 'X-OpenQareer-Device-Id': deviceId } : {}),
    },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export async function fetchPasskeyLoginOptions(): Promise<
  PasskeyChallenge<PublicKeyCredentialRequestOptionsJSON>
> {
  return parseChallenge(
    await readData<unknown>(await postJson('/api/v1/auth/passkey/options', {})),
  );
}

/** Ответ ключа на вызов: при успехе сервер выдаёт сессию так же, как вход по паролю. */
export async function loginWithPasskey(
  token: string,
  response: AuthenticationResponseJSON,
): Promise<AuthUser> {
  return readDataObject<AuthUser>(await postJson('/api/v1/auth/passkey', { token, response }));
}

export type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON };
