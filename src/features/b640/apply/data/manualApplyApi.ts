import type { ManualApplyItem, ManualApplyReason } from '../../../../../shared/manualApply';
import { apiFetch, readDataObject } from '../../../coach/apiClient';

const BASE = '/api/v1/candidate/manual-applications';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const itemPath = (vacancyId: string): string => `${BASE}/${encodeURIComponent(vacancyId)}`;

/** Поставить отклик в очередь «отправить вручную»: всё для него собирается в фоне (B787). */
export async function queueManualApply(input: {
  readonly vacancyId: string;
  readonly reason: ManualApplyReason;
  readonly host?: string;
}): Promise<ManualApplyItem> {
  const response = await apiFetch(BASE, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  });
  return readDataObject<ManualApplyItem>(response);
}

export async function listManualQueue(signal?: AbortSignal): Promise<readonly ManualApplyItem[]> {
  const response = await apiFetch(BASE, { signal });
  const body = (await response.json()) as { readonly data?: unknown };
  return response.ok && Array.isArray(body.data) ? (body.data as ManualApplyItem[]) : [];
}

export async function getManualApply(
  vacancyId: string,
  signal?: AbortSignal,
): Promise<ManualApplyItem> {
  return readDataObject<ManualApplyItem>(await apiFetch(itemPath(vacancyId), { signal }));
}

/** «Отправлено» и «Не откликаюсь»: отклик уходит из очереди. */
export async function closeManualApply(
  vacancyId: string,
  how: 'sent' | 'skip',
): Promise<{ readonly applicationId: string }> {
  const response = await apiFetch(`${itemPath(vacancyId)}/${how}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: '{}',
  });
  return readDataObject<{ readonly applicationId: string }>(response);
}
