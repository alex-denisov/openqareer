import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../coach/apiClient';
import { requestTriage } from './triageApi';

vi.mock('../../coach/apiClient', async (original) => ({
  ...(await original<typeof import('../../coach/apiClient')>()),
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const data = {
  rows: [{ clusterId: 'a', verdict: 'keep' }],
  questions: [],
  questionTotal: 0,
  summary: { total: 1, keep: 1, hide: 0, needsData: 0 },
};

beforeEach(() => fetchMock.mockReset());

describe('разбор списка', () => {
  it('шлёт id и ответы, возвращает разбор', async () => {
    fetchMock.mockResolvedValue(json({ data, meta: { requestId: 'r' } }));
    const result = await requestTriage({ clusterIds: ['a'] }, { salaryLowerBound: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/candidate/b640/vacancy-triage');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      clusterIds: ['a'],
      answers: { salaryLowerBound: true },
    });
    expect(result.summary.total).toBe(1);
  });

  it('чужая форма ответа — ошибка', async () => {
    fetchMock.mockResolvedValue(json({ data: { rows: 1 } }));
    await expect(requestTriage({ clusterIds: ['a'] }, {})).rejects.toThrow();
  });

  it('ошибка сервера пробрасывается', async () => {
    fetchMock.mockResolvedValue(json({ error: { message: 'сбой' } }, 500));
    await expect(requestTriage({ clusterIds: ['a'] }, {})).rejects.toThrow();
  });
});
