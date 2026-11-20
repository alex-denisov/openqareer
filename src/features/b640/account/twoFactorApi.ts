import { apiFetch, malformedResponseError, readData } from '../../coach/apiClient';

/** B401: двухфакторная защита в n04. Резервные коды живут только в ответе — нигде не сохраняются. */
export interface TwoFactorStatus {
  readonly enabled: boolean;
  readonly backupCodesLeft: number;
}

export interface TwoFactorSetup {
  readonly secret: string;
  readonly otpauthUrl: string;
}

const BASE = '/api/v1/account/two-factor';

function post(url: string, body: object): Promise<Response> {
  return apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function backupCodes(value: unknown): readonly string[] {
  const codes = (value as { backupCodes?: unknown } | null)?.backupCodes;
  if (!Array.isArray(codes) || !codes.every((code) => typeof code === 'string')) throw malformedResponseError();
  return codes;
}

export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  const data = await readData<TwoFactorStatus>(await apiFetch(BASE));
  if (typeof data?.enabled !== 'boolean' || typeof data.backupCodesLeft !== 'number') throw malformedResponseError();
  return { enabled: data.enabled, backupCodesLeft: data.backupCodesLeft };
}

export async function startTwoFactorSetup(): Promise<TwoFactorSetup> {
  const data = await readData<TwoFactorSetup>(await post(`${BASE}/setup`, {}));
  if (typeof data?.secret !== 'string' || !data.otpauthUrl?.startsWith('otpauth://totp/')) throw malformedResponseError();
  return { secret: data.secret, otpauthUrl: data.otpauthUrl };
}

/** Включение: код из приложения и текущий пароль; ответ — восемь резервных кодов, один раз. */
export async function enableTwoFactor(code: string, password: string): Promise<readonly string[]> {
  return backupCodes(await readData<unknown>(await post(`${BASE}/enable`, { code: code.trim(), password })));
}

/** Новые резервные коды по коду из приложения (или резервному); прежние перестают действовать. */
export async function regenerateBackupCodes(code: string): Promise<readonly string[]> {
  return backupCodes(await readData<unknown>(await post(`${BASE}/backup-codes`, { code: code.trim() })));
}

export async function disableTwoFactor(code: string): Promise<void> {
  await readData<unknown>(await post(`${BASE}/disable`, { code: code.trim() }));
}
