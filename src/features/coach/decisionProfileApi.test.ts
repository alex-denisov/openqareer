import { afterEach, expect, it, vi } from 'vitest';
import { apiFetch } from './apiClient';
import { putDecisionProfile } from './decisionProfileApi';

vi.mock('./apiClient', () => ({ apiFetch: vi.fn() }));
afterEach(() => vi.clearAllMocks());

it('B788: копия условий с экрана не возвращает стёртое право на работу', async () => {
  vi.mocked(apiFetch).mockResolvedValue(new Response('{}'));
  await putDecisionProfile({
    citizenship: [],
    languages: [],
    workFormats: ['office'],
    workRights: [{ country: 'US', status: 'authorized' }],
  });
  const body = JSON.parse(vi.mocked(apiFetch).mock.calls[0]![1]!.body as string);
  expect(body).toEqual({ citizenship: [], languages: [], workFormats: ['office'] });
});
