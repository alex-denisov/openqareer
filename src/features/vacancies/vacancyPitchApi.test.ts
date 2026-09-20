import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestVacancyPitch } from './vacancyPitchApi';
import * as apiClient from '../coach/apiClient';

// Владелец 2026-09-20: «Подготовить отклик» в .app показывало «The string did
// not match the expected pattern» — голый `fetch('/api/…')` на tauri-origin
// не умеет относительных адресов и не несёт ни токена, ни Origin. Все запросы
// кабинета ходят через `apiFetch`; отклик — не исключение.
describe('requestVacancyPitch', () => {
  afterEach(() => vi.restoreAllMocks());

  it('goes through apiFetch with the pitch payload', async () => {
    const payload = {
      vacancyId: 'v-1',
      emailPitch: { subject: 's', body: 'b' },
      linkedInNote: 'n',
      atsCoverLetter: 'c',
      usedEvidenceIds: [],
      generatedAt: '2026-09-20T00:00:00.000Z',
    };
    const spy = vi
      .spyOn(apiClient, 'apiFetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: payload }), { status: 200 }));

    const result = await requestVacancyPitch('v-1', { tone: 'technical' });

    expect(result).toEqual(payload);
    expect(spy).toHaveBeenCalledWith(
      '/api/v1/candidate/vacancies/v-1/pitch',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ tone: 'technical' }) }),
    );
  });

  it('surfaces the server message on failure', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: 'Вакансия не найдена.', code: 'vacancy_not_found' } }),
        {
          status: 404,
        },
      ),
    );
    await expect(requestVacancyPitch('v-404')).rejects.toThrow('Вакансия не найдена.');
  });
});
