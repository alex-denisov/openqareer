import { describe, expect, it } from 'vitest';
import {
  chooseStrategyRole,
  type CareerStrategy,
  type StrategyProvenance,
  type StrategyRole,
} from './careerStrategy';

const provenance: StrategyProvenance = {
  namedBy: 'gemini:gemini-3.6-flash',
  language: 'en',
  poolSize: 534,
};

function role(title: string, overrides: Partial<StrategyRole> = {}): StrategyRole {
  return {
    title,
    origin: 'model',
    reason: 'вёл продукты девять лет',
    evidenceRefs: ['memory:1'],
    confirmation: { state: 'not-found', sampleSize: 0 },
    ...overrides,
  };
}

const constraints = { regions: ['eu'], note: null };

describe('chooseStrategyRole', () => {
  it('первый выбор создаёт версию 1 с датой и провенансом', () => {
    const result = chooseStrategyRole({
      previous: null,
      role: role('Product Manager'),
      constraints,
      reason: null,
      decidedAt: '2026-09-03T16:00:00.000Z',
      provenance,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy.current).toMatchObject({
      version: 1,
      decidedAt: '2026-09-03T16:00:00.000Z',
      provenance,
    });
    expect(result.strategy.current.role.title).toBe('Product Manager');
    expect(result.strategy.history).toEqual([]);
  });

  it('смена роли создаёт новую версию, прежняя остаётся в истории', () => {
    const first = chooseStrategyRole({
      previous: null,
      role: role('Product Manager'),
      constraints,
      reason: null,
      decidedAt: '2026-09-01T10:00:00.000Z',
      provenance,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = chooseStrategyRole({
      previous: first.strategy,
      role: role('Head of Product'),
      constraints,
      reason: 'откликов много, разговоров нет',
      decidedAt: '2026-09-03T16:00:00.000Z',
      provenance,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.strategy.current).toMatchObject({
      version: 2,
      reason: 'откликов много, разговоров нет',
    });
    expect(second.strategy.current.role.title).toBe('Head of Product');
    // Прежняя гипотеза сохраняется как альтернатива, а не удаляется.
    expect(second.strategy.history.map((entry) => entry.role.title)).toEqual([
      'Product Manager',
    ]);
  });

  it('смена роли без причины не проходит', () => {
    const first = chooseStrategyRole({
      previous: null,
      role: role('Product Manager'),
      constraints,
      reason: null,
      decidedAt: '2026-09-01T10:00:00.000Z',
      provenance,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = chooseStrategyRole({
      previous: first.strategy,
      role: role('Head of Product'),
      constraints,
      reason: '   ',
      decidedAt: '2026-09-03T16:00:00.000Z',
      provenance,
    });

    // Кандидат обязан увидеть, что изменилось и почему: смена роли обнуляет
    // воронку, и молча она не делается.
    expect(second).toEqual({ ok: false, error: 'reason_required' });
  });

  it('повторный выбор той же роли версию не плодит', () => {
    const first = chooseStrategyRole({
      previous: null,
      role: role('Product Manager'),
      constraints,
      reason: null,
      decidedAt: '2026-09-01T10:00:00.000Z',
      provenance,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const again = chooseStrategyRole({
      previous: first.strategy,
      role: role('  product manager  '),
      constraints,
      reason: null,
      decidedAt: '2026-09-03T16:00:00.000Z',
      provenance,
    });

    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.strategy.current.version).toBe(1);
    expect(again.strategy.current.decidedAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('версия хранит снимок подтверждения, а не ссылку на пул', () => {
    const result = chooseStrategyRole({
      previous: null,
      role: role('Product Manager', {
        confirmation: {
          state: 'observed',
          sampleSize: 12,
          observedFrom: '2026-08-20',
          observedTo: '2026-09-02',
        },
      }),
      constraints,
      reason: null,
      decidedAt: '2026-09-03T16:00:00.000Z',
      provenance,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Пул меняется каждый час; версия обязана помнить, что было видно тогда.
    expect(result.strategy.current.role.confirmation).toEqual({
      state: 'observed',
      sampleSize: 12,
      observedFrom: '2026-08-20',
      observedTo: '2026-09-02',
    });
  });

  it('история хранит порядок: свежая версия впереди', () => {
    let strategy: CareerStrategy | null = null;
    for (const [index, title] of ['A', 'B', 'C'].entries()) {
      const step = chooseStrategyRole({
        previous: strategy,
        role: role(title),
        constraints,
        reason: 'причина',
        decidedAt: `2026-09-0${index + 1}T10:00:00.000Z`,
        provenance,
      });
      expect(step.ok).toBe(true);
      if (!step.ok) return;
      strategy = step.strategy;
    }

    expect(strategy?.current.role.title).toBe('C');
    expect(strategy?.history.map((entry) => entry.role.title)).toEqual(['B', 'A']);
  });
});
