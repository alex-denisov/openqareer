import type {
  FactCorrectionChange,
  FactCorrectionOutcome,
} from '../../../../shared/factCorrection';
import { apiFetch, readDataObject } from '../../coach/apiClient';

const URL = '/api/v1/candidate/fact-corrections';

async function post<T extends object>(url: string, body: unknown): Promise<T> {
  const response = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readDataObject<T>(response);
}

/** Исправление записи и всех её копий; ответ приходит после перечитывания записанного. */
export async function correctFact(change: FactCorrectionChange): Promise<FactCorrectionOutcome> {
  const outcome = await post<FactCorrectionOutcome>(URL, change);
  if (!outcome.changes?.some(({ after }) => after === change.after)) {
    throw new Error('fact_correction_not_saved');
  }
  return outcome;
}

export async function revertFactCorrection(id: string): Promise<void> {
  await post<{ reverted: boolean }>(`${URL}/revert`, { id });
}
