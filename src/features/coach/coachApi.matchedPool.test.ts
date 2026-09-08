import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMatchedVacancies, getMatchedVacancyPage } from './coachApi';

/**
 * Смещения страниц приходят в `meta` первой страницы (B211). Клиент, который
 * их не читает, продолжает ходить по одной странице за круг — шестьдесят
 * кругов на вход и шестьдесят шансов словить обрыв INC-036 (PRB-023).
 */
describe('страница подбора несёт план чтения', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function respond(meta: Record<string, unknown>) {
    return vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [], meta }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  it('читает смещения всех страниц из ответа', async () => {
    vi.stubGlobal('fetch', respond({ total: 24, nextOffset: 6, pageOffsets: [0, 6, 12, 18] }));
    const page = await getMatchedVacancyPage(0);
    expect(page.pageOffsets).toEqual([0, 6, 12, 18]);
    expect(page.nextOffset).toBe(6);
  });

  it('ответ без плана планом не притворяется', async () => {
    vi.stubGlobal('fetch', respond({ total: 24, nextOffset: 6 }));
    const page = await getMatchedVacancyPage(0);
    expect(page.pageOffsets).toBeUndefined();
  });

  it('чужой тип на месте плана не становится смещениями', async () => {
    vi.stubGlobal('fetch', respond({ total: 24, nextOffset: 6, pageOffsets: 'все' }));
    const page = await getMatchedVacancyPage(0);
    expect(page.pageOffsets).toBeUndefined();
  });
});

/**
 * Отказ маршрута и ответ неожиданной формы — не пустой пул: молчание сделало
 * бы недоступный подбор неотличимым от честно пустого (B161).
 */
describe('отказ чтения подбора называется отказом', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('отказ маршрута не превращается в пустую страницу', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Маршрут отказал.' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await expect(getMatchedVacancyPage(0)).rejects.toThrow();
  });

  it('ответ без списка записей разбором не считается', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { items: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await expect(getMatchedVacancyPage(0)).rejects.toThrow('Ответ сервиса не разобран.');
  });

  it('первая страница отдаётся как готовый список записей', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ cluster: { id: 'c-1' } }], meta: { total: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const items = await getMatchedVacancies();
    expect(items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/candidate/matched-vacancies?offset=0',
      expect.objectContaining({ signal: undefined }),
    );
  });
});
