import type { ApplyConsentInput, ApplyConsentResult } from '../../../../../shared/applyConsent';
import { apiFetch, throwApiError } from '../../../coach/apiClient';

/** B787: журнал согласий по поручению кандидата. */
export interface AtsConsentJournal {
  /** Записать согласие до нажатия; ошибка означает, что нажимать нельзя. */
  readonly record: (entry: ApplyConsentInput) => Promise<void>;
  readonly result: (id: string, result: ApplyConsentResult) => Promise<void>;
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
