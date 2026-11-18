import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../coach/apiClient';
import { createOwnVacancy, deleteOwnVacancy, listOwnVacancies, ownVacancySource } from './ownVacancyApi';

vi.mock('../../coach/apiClient', async (original) => ({
  ...(await original<typeof import('../../coach/apiClient')>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const vacancy = { id: 'own-1', title: 'Аналитик', company: null, location: null, workFormat: null, url: null, createdAt: '2026-11-18T10:00:00.000Z', coverage: null, comparing: true };

beforeEach(() => fetchMock.mockReset());

describe('своя вакансия: API', () => {
  it('одна строка с http(s) — ссылка, остальное — текст', () => {
    expect(ownVacancySource('  https://jobs.example.com/a/1 ')).toEqual({ link: 'https://jobs.example.com/a/1' });
    expect(ownVacancySource('Аналитик\n\nhttps://jobs.example.com/a/1')).toEqual({ text: 'Аналитик\n\nhttps://jobs.example.com/a/1' });
    expect(ownVacancySource('jobs.example.com/a')).toEqual({ text: 'jobs.example.com/a' });
  });
  it('создание шлёт POST с источником и возвращает итог', async () => {
    fetchMock.mockResolvedValue(json({ data: { outcome: 'created', vacancy }, meta: { requestId: 'r' } }));
    const result = await createOwnVacancy({ link: 'https://jobs.example.com/a/1' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/candidate/b640/own-vacancies');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ link: 'https://jobs.example.com/a/1' });
    expect(result).toEqual({ outcome: 'created', vacancy });
  });
  it('нечитаемая страница и предел — итог без вакансии', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { outcome: 'unreadable', reason: 'site_closed' } }));
    expect(await createOwnVacancy({ text: 'x'.repeat(50) })).toEqual({ outcome: 'unreadable', reason: 'site_closed' });
    fetchMock.mockResolvedValueOnce(json({ data: { outcome: 'nonsense' } }));
    await expect(createOwnVacancy({ text: 'x'.repeat(50) })).rejects.toThrow();
  });
  it('список и удаление', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [vacancy] }));
    expect(await listOwnVacancies()).toEqual([vacancy]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteOwnVacancy('own-1');
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/v1/candidate/b640/own-vacancies/own-1');
    expect(fetchMock.mock.calls[1]![1]?.method).toBe('DELETE');
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'own_vacancy_not_found', message: 'Вакансия не найдена.' } }, 404));
    await expect(deleteOwnVacancy('own-2')).rejects.toThrow();
  });
});
