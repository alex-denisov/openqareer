import { apiFetch, readData, throwApiError } from '../../coach/apiClient';

/** B689: удаление аккаунта с отсрочкой; `null` — удаление не запрошено. */
export interface AccountDeletion {
  readonly requestedAt: string;
  readonly purgeAfter: string;
}

const PATH = '/api/v1/candidate/account/deletion';

export async function getAccountDeletion(): Promise<AccountDeletion | null> {
  return readData<AccountDeletion | null>(await apiFetch(PATH));
}

export async function requestAccountDeletion(): Promise<AccountDeletion> {
  return readData<AccountDeletion>(await apiFetch(PATH, { method: 'POST' }));
}

export async function restoreAccount(): Promise<void> {
  const response = await apiFetch(PATH, { method: 'DELETE' });
  if (!response.ok) await throwApiError(response);
}
