import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../../coach/apiClient', () => ({
  apiFetch: fetchMock,
  readData: async () => ({}),
}));

import { createEntry, createGoalCard, recordMeasurement } from './diaryApi';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sentKey(): unknown {
  const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
  return (init?.headers as Record<string, string> | undefined)?.['Idempotency-Key'];
}

describe('diaryApi: создание отвечает 400 без Idempotency-Key на сервере', () => {
  beforeEach(() => fetchMock.mockReset().mockResolvedValue(new Response('{}')));

  it('запись дневника отправляет ключ (на проде 20.11 запись не сохранялась)', async () => {
    await createEntry({ kind: 'note', text: 'тест' } as Parameters<typeof createEntry>[0]);
    expect(sentKey()).toMatch(UUID);
  });

  it('цель и замер отправляют ключ', async () => {
    await createGoalCard({} as Parameters<typeof createGoalCard>[0]);
    expect(sentKey()).toMatch(UUID);
    await recordMeasurement('ind-1', { value: 1, measuredAt: '2026-11-20' });
    expect(sentKey()).toMatch(UUID);
  });
});
