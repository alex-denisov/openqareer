import type { B640HhRaiseClaim, B640HhRaiseState, HhRaiseOutcome } from '../../../../../shared/b640HhRaise';
import { apiFetch, readDataObject } from '../../../coach/apiClient';

const BASE = '/api/v1/candidate/b640/hh/raise';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function getHhRaise(signal?: AbortSignal): Promise<B640HhRaiseState> {
  return readDataObject<B640HhRaiseState>(await apiFetch(BASE, { signal }));
}

export async function setHhRaiseEnabled(enabled: boolean, resumeId?: string): Promise<B640HhRaiseState> {
  const response = await apiFetch(BASE, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ enabled, ...(resumeId ? { resumeId } : {}) }),
  });
  return readDataObject<B640HhRaiseState>(response);
}

export async function retryHhRaise(resumeId?: string): Promise<B640HhRaiseState> {
  const response = await apiFetch(`${BASE}/retry`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(resumeId ? { resumeId } : {}),
  });
  return readDataObject<B640HhRaiseState>(response);
}

/** Клиент берёт готовое к исполнению поднятие; `task: null` — задач нет. */
export async function claimHhRaise(): Promise<B640HhRaiseClaim> {
  return readDataObject<B640HhRaiseClaim>(await apiFetch(`${BASE}/claim`, { method: 'POST' }));
}

export async function sendHhRaiseResult(taskId: string, outcome: HhRaiseOutcome, availableAt?: string): Promise<void> {
  const response = await apiFetch(`${BASE}/${encodeURIComponent(taskId)}/result`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ outcome, ...(availableAt ? { availableAt } : {}) }),
  });
  await readDataObject<B640HhRaiseState>(response);
}
