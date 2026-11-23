import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGoalHints, GOAL_EXAMPLES_DEADLINE_MS } from './goalHintModel';

afterEach(() => {
  vi.useRealTimers();
});

/** Площадка не отвечает и не слышит отмену: ступень висит, пока её не бросит срок. */
const hangingFetch = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;

describe('B768: срок примеров целей (d02c)', () => {
  it('модель зависла — после срока ответ «примеров нет», а не вечное ожидание', async () => {
    vi.useFakeTimers();
    const onFailure = vi.fn();
    const hints = buildGoalHints({
      providerCredentials: { openrouter: 'test-key' },
      fetchImpl: hangingFetch,
      onStageFailure: onFailure,
    });
    expect(hints).toBeDefined();
    let answer: unknown = 'pending';
    void hints!.examples('Коммерческий директор').then((items) => (answer = items));
    await vi.advanceTimersByTimeAsync(GOAL_EXAMPLES_DEADLINE_MS - 1);
    expect(answer).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toBeNull();
  });

  it('срок примеров — в пределах 15–20 с', () => {
    expect(GOAL_EXAMPLES_DEADLINE_MS).toBeGreaterThanOrEqual(15_000);
    expect(GOAL_EXAMPLES_DEADLINE_MS).toBeLessThanOrEqual(20_000);
  });
});
