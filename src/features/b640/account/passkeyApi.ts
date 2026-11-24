import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { z } from 'zod';
import { apiFetch, malformedResponseError, readData } from '../../coach/apiClient';
import { parseChallenge, postJson, type PasskeyChallenge } from '../../coach/passkeyLoginApi';

/** B755: ключи доступа в n04. Показываем только название устройства и даты — ключи остаются на сервере. */
const summarySchema = z.object({
  id: z.string(),
  deviceLabel: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type PasskeySummary = z.infer<typeof summarySchema>;

const BASE = '/api/v1/account/passkeys';

export interface PasskeyProof {
  readonly password: string;
  /** Код из приложения: нужен, когда включена двухфакторная защита. */
  readonly code?: string;
}

export async function listPasskeys(): Promise<readonly PasskeySummary[]> {
  const data = await readData<unknown>(await apiFetch(BASE));
  const parsed = z.object({ passkeys: z.array(summarySchema) }).safeParse(data);
  if (!parsed.success) throw malformedResponseError();
  return parsed.data.passkeys;
}

export async function requestPasskeyOptions(
  proof: PasskeyProof,
): Promise<PasskeyChallenge<PublicKeyCredentialCreationOptionsJSON>> {
  const body = {
    password: proof.password,
    ...(proof.code?.trim() ? { code: proof.code.trim() } : {}),
  };
  return parseChallenge(await readData<unknown>(await postJson(`${BASE}/options`, body)));
}

export async function registerPasskey(
  token: string,
  response: RegistrationResponseJSON,
): Promise<void> {
  await readData<unknown>(await postJson(BASE, { token, response }));
}
