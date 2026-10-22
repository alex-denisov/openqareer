import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVacancySources } from './coachApi';

/**
 * Экран «Вакансии» на 390 спрашивал каталог источников трижды одновременно
 * (фильтр, сохранённые поиски, подборка): по 1,2–1,4 с каждый (B447).
 */
describe('каталог источников', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const respond = () =>
    vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: [{ id: 'hh' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

  it('одновременные вызовы делят один запрос', async () => {
    const fetchMock = respond();
    vi.stubGlobal('fetch', fetchMock);
    const results = await Promise.all([
      getVacancySources(),
      getVacancySources(),
      getVacancySources(),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.map((items) => items.length)).toEqual([1, 1, 1]);
  });

  it('следующий вызов после ответа спрашивает заново, а не держит старый каталог', async () => {
    const fetchMock = respond();
    vi.stubGlobal('fetch', fetchMock);
    await getVacancySources();
    await getVacancySources();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ошибка не застревает: следующий вызов пробует снова', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(getVacancySources()).rejects.toThrow();
    const fetchMock = respond();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getVacancySources()).resolves.toHaveLength(1);
  });
});
