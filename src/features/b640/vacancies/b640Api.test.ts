import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../coach/apiClient';
import { getApplicationQuota, getHiddenVacancies, getSortedMatchedPage, matchedPageQuery } from './b640Api';

vi.mock('../../coach/apiClient', async (original) => ({
  ...(await original<typeof import('../../coach/apiClient')>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const row = (id: string) => ({ cluster: { id }, explanation: {}, hidden: { reasonId: 'stale', at: '2026-11-11T09:00:00Z' } });

beforeEach(() => fetchMock.mockReset());

describe('скрытые вакансии', () => {
  it('читает порцию и границы', async () => {
    fetchMock.mockResolvedValue(json({ data: [row('a')], meta: { total: 5, offset: 0, limit: 20, nextOffset: 20 } }));
    const page = await getHiddenVacancies(0);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/candidate/b640/hidden-vacancies?offset=0&limit=20');
    expect(page.rows.map((entry) => entry.cluster.id)).toEqual(['a']);
    expect(page).toMatchObject({ total: 5, nextOffset: 20 });
  });

  it('ответ без списка — ошибка, а не пустая страница', async () => {
    fetchMock.mockResolvedValue(json({ data: null, meta: {} }));
    await expect(getHiddenVacancies(0)).rejects.toThrow();
  });

  it('сбой сервера — ошибка', async () => {
    fetchMock.mockResolvedValue(json({ error: { message: 'Нет доступа' } }, 404));
    await expect(getHiddenVacancies(0)).rejects.toThrow();
  });
});

describe('подборка с серверной сортировкой', () => {
  it('столбец «Локация» уходит как location, роли и порция — в запрос', () => {
    const query = new URLSearchParams(matchedPageQuery({ key: 'geo', dir: 'asc' }, ['CTO', 'CIO'], 40));
    expect(query.get('sort')).toBe('location');
    expect(query.get('direction')).toBe('asc');
    expect(query.get('offset')).toBe('40');
    expect(query.get('limit')).toBe('20');
    expect(query.getAll('role')).toEqual(['CTO', 'CIO']);
    expect(query.has('dir')).toBe(false);
  });

  it('B726: «Дата» — дни и пояс кандидата; без даты их нет', () => {
    const dated = new URLSearchParams(matchedPageQuery({ key: 'date', dir: 'desc' }, ['COO'], 0, 30));
    expect(dated.get('days')).toBe('30');
    expect(dated.get('tz')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const plain = new URLSearchParams(matchedPageQuery({ key: 'date', dir: 'desc' }, ['COO'], 0));
    expect(plain.has('days')).toBe(false);
    expect(plain.has('tz')).toBe(false);
  });

  it('«Зарплата от» уходит серверу суммой в месяц и валютой (B765)', () => {
    const money = { from: 350_000, currency: 'RUB' } as const;
    const query = new URLSearchParams(matchedPageQuery({ key: 'fit', dir: 'desc' }, [], 0, null, money));
    expect(query.get('money')).toBe('350000');
    expect(query.get('moneyCurrency')).toBe('RUB');
    expect(query.has('days')).toBe(false);
    const plain = new URLSearchParams(matchedPageQuery({ key: 'fit', dir: 'desc' }, [], 0));
    expect(plain.has('money')).toBe(false);
  });

  it('читает строки, всего и следующее смещение', async () => {
    fetchMock.mockResolvedValue(json({ data: [row('a'), row('b')], meta: { total: 9, nextOffset: null } }));
    const page = await getSortedMatchedPage({ key: 'money', dir: 'desc' }, [], 0);
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/v1/candidate/b640/matched-vacancies?');
    expect(page).toMatchObject({ total: 9, nextOffset: null });
    expect(page.rows).toHaveLength(2);
  });

  it('сбой — ошибка', async () => {
    fetchMock.mockResolvedValue(json({}, 500));
    await expect(getSortedMatchedPage({ key: 'fit', dir: 'asc' }, [], 0)).rejects.toThrow();
  });
});

describe('остаток откликов', () => {
  it('отдаёт данные квоты', async () => {
    const data = { plan: 'free', limit: 10, used: 7, remaining: 3, renewsAt: null };
    fetchMock.mockResolvedValue(json({ data, meta: {} }));
    expect(await getApplicationQuota()).toEqual(data);
  });

  it('не объект — ошибка', async () => {
    fetchMock.mockResolvedValue(json({ data: 5 }));
    await expect(getApplicationQuota()).rejects.toThrow();
  });
});
