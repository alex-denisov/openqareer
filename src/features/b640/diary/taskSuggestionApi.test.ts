import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
const dataMock = vi.hoisted(() => vi.fn());
vi.mock('../../coach/apiClient', () => ({
  apiFetch: fetchMock,
  readData: dataMock,
  throwApiError: async () => {
    throw new Error('api');
  },
}));

import { acceptTaskSuggestion, getTaskSuggestion, skipTaskSuggestion } from './taskSuggestionApi';

const BASE = '/api/v1/candidate/career-diary/goal-cards/g1/task-suggestion';

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  dataMock.mockReset();
});

describe('B743 · 2: клиент подсказки задачи', () => {
  it('читает подсказку цели', async () => {
    dataMock.mockResolvedValue({ id: 's1', text: 'Подготовить повестку', dueDate: '2027-01-12' });
    await expect(getTaskSuggestion('g1')).resolves.toEqual({
      id: 's1',
      text: 'Подготовить повестку',
      dueDate: '2027-01-12',
    });
    expect(fetchMock).toHaveBeenCalledWith(BASE);
  });

  it('null и ответ не той формы — подсказки нет', async () => {
    for (const data of [
      null,
      {},
      { id: 's1', text: '  ', dueDate: '2027-01-12' },
      { id: 's1', text: 'Т', dueDate: 'завтра' },
    ]) {
      dataMock.mockResolvedValue(data);
      await expect(getTaskSuggestion('g1')).resolves.toBeNull();
    }
  });

  it('«принято» и «пропущено» — POST по id без чтения тела', async () => {
    await expect(acceptTaskSuggestion('g1', 's1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(`${BASE}/s1/accept`);
    expect((fetchMock.mock.calls.at(-1)![1] as RequestInit).method).toBe('POST');
    await skipTaskSuggestion('g1', 's1');
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(`${BASE}/s1/skip`);
  });

  it('отказ сервера — исключение', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(skipTaskSuggestion('g1', 's1')).rejects.toThrow();
  });
});
