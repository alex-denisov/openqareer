import type { CareerDiaryInterviewPractice, CareerDiaryPage } from '../../../shared/careerDiary';
import { apiFetch, readData } from '../coach/apiClient';
const base = '/api/v1/candidate/career-diary/interview-practices';
export async function saveInterviewPractice(id: string): Promise<CareerDiaryInterviewPractice> {
  return readData(await apiFetch(`${base}/${encodeURIComponent(id)}`, { method: 'PUT' }));
}
export async function listInterviewPractices(cursor?: string, signal?: AbortSignal): Promise<CareerDiaryPage<CareerDiaryInterviewPractice>> {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  return readData(await apiFetch(`${base}?${query}`, { signal }));
}
export async function deleteInterviewPractice(id: string): Promise<void> {
  await readData(await apiFetch(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}
