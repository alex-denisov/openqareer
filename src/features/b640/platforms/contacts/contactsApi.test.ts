import { afterEach, describe, expect, it, vi } from 'vitest';
import { contactsQueryString, listB640Contacts, setB640ContactStatus } from './contactsApi';

const fetchMock = vi.fn();
vi.mock('../../../coach/apiClient', async (original) => ({
  ...(await original<typeof import('../../../coach/apiClient')>()),
  apiFetch: (...args: unknown[]) => fetchMock(...args),
}));

afterEach(() => fetchMock.mockReset());

describe('contactsQueryString', () => {
  it('повторяет значения фильтров и не пишет пустое', () => {
    const query = contactsQueryString({
      search: ' Ким ',
      filters: { company: ['Гринкод', 'Арка'], link: ['intro'], status: [] },
      sort: 'recent',
      offset: 20,
    });
    const params = new URLSearchParams(query);
    expect(params.getAll('company')).toEqual(['Гринкод', 'Арка']);
    expect(params.getAll('link')).toEqual(['intro']);
    expect(params.has('status')).toBe(false);
    expect(params.get('search')).toBe('Ким');
    expect(params.get('sort')).toBe('recent');
    expect(params.get('offset')).toBe('20');
    expect(params.get('limit')).toBe('20');
  });

  it('пустой поиск не попадает в запрос', () => {
    const query = contactsQueryString({ search: '  ', filters: { company: [], link: [], status: [] }, sort: 'selection', offset: 0 });
    expect(new URLSearchParams(query).has('search')).toBe(false);
  });
});

describe('API', () => {
  it('читает список по адресу B697', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { items: [], total: 0 } }), { status: 200 }));
    await listB640Contacts({ search: '', filters: { company: [], link: [], status: [] }, sort: 'name', offset: 0 });
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/^\/api\/v1\/candidate\/b640\/contacts\?/u);
  });

  it('меняет статус PUT с телом {state}', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { contactId: 'c/1', state: 'written', at: 'x' } }), { status: 200 }));
    await setB640ContactStatus('c/1', 'written');
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/v1/candidate/b640/contacts/c%2F1/status');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"state":"written"}');
  });
});
