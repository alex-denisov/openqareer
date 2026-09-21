import { describe, expect, it } from 'vitest';
import {
  CHANGE_ORDER,
  reviewStrategy,
  roleChangeBarrier,
} from './strategyReview';

const NOW = '2026-09-20T12:00:00.000Z';
const day = 86_400_000;
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * day).toISOString();

function input(overrides: Partial<Parameters<typeof reviewStrategy>[0]> = {}) {
  return {
    strategyDecidedAt: daysAgo(20),
    commands: [],
    pool: { size: 500, oldestObservedAt: daysAgo(10), newestObservedAt: daysAgo(1) },
    now: NOW,
    ...overrides,
  };
}

function signal(result: ReturnType<typeof reviewStrategy>, id: string) {
  const found = result.signals.find((item) => item.id === id);
  expect(found).toBeDefined();
  return found!;
}

describe('reviewStrategy', () => {
  it('семь дней без единого отклика при непустой очереди — авария, а не стратегия', () => {
    const result = reviewStrategy(
      input({
        commands: [{ status: 'queued', deliveredAt: null }],
      }),
    );

    const stall = signal(result, 'transport-stall');
    expect(stall.state).toBe('fired');
    // Прямое требование: чинить транспорт, не трогая гипотезу роли.
    expect(stall.whatToChange).toEqual(['канал отклика']);
    expect(stall.note).toContain('Роль ни при чём');
  });

  it('свежие отклики аварию не поднимают', () => {
    const result = reviewStrategy(
      input({
        commands: [{ status: 'completed_with_receipt', deliveredAt: daysAgo(2) }],
      }),
    );
    expect(signal(result, 'transport-stall').state).toBe('quiet');
  });

  it('пустая очередь — не авария: отправлять было нечего', () => {
    const result = reviewStrategy(input({ commands: [], pool: { size: 0, oldestObservedAt: null, newestObservedAt: null } }));
    expect(signal(result, 'transport-stall').state).toBe('not-enough-data');
  });

  it('выборка старше тридцати дней требует пересчёта спроса до любого вывода', () => {
    const result = reviewStrategy(
      input({ pool: { size: 300, oldestObservedAt: daysAgo(40), newestObservedAt: daysAgo(35) } }),
    );

    const stale = signal(result, 'demand-sample-age');
    expect(stale.state).toBe('fired');
    expect(stale.measure).toMatchObject({ value: 35, total: 30 });
  });

  it('свежая выборка молчит', () => {
    expect(signal(reviewStrategy(input()), 'demand-sample-age').state).toBe('quiet');
  });

  it('неотслеживаемое называет неотслеживаемым, а не нулём', () => {
    const result = reviewStrategy(input());

    for (const id of ['qualified-share', 'no-human-answer', 'first-conversation']) {
      const item = signal(result, id);
      expect(item.state).toBe('untracked');
      // Ноль означал бы «посмотрели и не нашли»; мы не смотрели вовсе.
      expect(item.measure).toBeUndefined();
      expect(item.note).toContain('не сообщает');
    }
  });

  it('порядок изменений идёт от дешёвого к дорогому и заканчивается ролью', () => {
    expect(CHANGE_ORDER[0]).toBe('канал отклика');
    expect(CHANGE_ORDER[CHANGE_ORDER.length - 1]).toBe('роль');
    expect(reviewStrategy(input()).oneVariableAtATime).toBe(true);
  });
});

describe('roleChangeBarrier', () => {
  it('до четырнадцати дней и двадцати откликов барьер не взят', () => {
    const barrier = roleChangeBarrier({
      strategyDecidedAt: daysAgo(3),
      delivered: 2,
      now: NOW,
    });

    expect(barrier.met).toBe(false);
    expect(barrier.days).toMatchObject({ value: 3, total: 14 });
    expect(barrier.delivered).toMatchObject({ value: 2, total: 20 });
    // Кандидат обязан увидеть, что именно теряет.
    expect(barrier.loses).toContain('воронк');
  });

  it('после четырнадцати дней и двадцати откликов барьер взят', () => {
    const barrier = roleChangeBarrier({
      strategyDecidedAt: daysAgo(15),
      delivered: 21,
      now: NOW,
    });
    expect(barrier.met).toBe(true);
  });

  it('без выбранной роли барьера нет вовсе: менять нечего', () => {
    expect(roleChangeBarrier({ strategyDecidedAt: null, delivered: 0, now: NOW }).met).toBe(true);
  });
});
