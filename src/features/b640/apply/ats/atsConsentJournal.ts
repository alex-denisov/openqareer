import { apiFetch, throwApiError } from '../../../coach/apiClient';

/**
 * B787: журнал согласий. Тело и итоги — контракт `shared/applyConsent.ts` (PR #1188);
 * после его слияния типы брать оттуда.
 */
export interface AtsConsentInput {
  readonly id: string;
  readonly applicationId: string | null;
  readonly host: string;
  readonly employer: string;
  readonly checkboxText: string;
  readonly policyUrl: string | null;
  readonly policySha256: string | null;
  readonly checkboxLabel: string | null;
  readonly command: string;
}

export type AtsConsentResult = 'sent' | 'failed' | 'unconfirmed';

export interface AtsConsentJournal {
  /** Записать согласие до нажатия; ошибка означает, что нажимать нельзя. */
  readonly record: (entry: AtsConsentInput) => Promise<void>;
  readonly result: (id: string, result: AtsConsentResult) => Promise<void>;
}

const PATH = '/api/v1/candidate/apply-consents';

async function post(path: string, body: unknown): Promise<void> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) await throwApiError(response);
}

export const serverConsentJournal: AtsConsentJournal = {
  record: (entry) => post(PATH, entry),
  result: (id, result) => post(`${PATH}/${encodeURIComponent(id)}/result`, { result }),
};
