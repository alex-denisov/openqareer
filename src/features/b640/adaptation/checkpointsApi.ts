import type { CareerDiaryDay30Check, CareerDiaryResults90 } from '../../../../shared/careerDiaryCheckpoints';
import { apiFetch, readData } from '../../coach/apiClient';

/** Клиент маршрутов B687: проверка на 30-й день и итоги 90 дней (под флагом B640). */
const place = (id: string) => `/api/v1/candidate/career-diary/workplaces/${encodeURIComponent(id)}`;

async function read<T>(path: string, init?: RequestInit): Promise<T> {
  return readData<T>(await apiFetch(path, init));
}

export function getDay30(id: string): Promise<CareerDiaryDay30Check> {
  return read(`${place(id)}/day-30`);
}

export function markDay30Sent(id: string, sentOn: string): Promise<CareerDiaryDay30Check> {
  return read(`${place(id)}/day-30/sent`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sentOn }),
  });
}

export function unmarkDay30Sent(id: string): Promise<CareerDiaryDay30Check> {
  return read(`${place(id)}/day-30/sent`, { method: 'DELETE' });
}

export function getResults90(id: string): Promise<CareerDiaryResults90> {
  return read(`${place(id)}/results-90`);
}
