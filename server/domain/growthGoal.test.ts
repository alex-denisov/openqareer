import { describe, expect, it } from 'vitest';
import {
  GROWTH_GOALS,
  growthArguments,
  growthSteps,
  type GrowthEntry,
  type GrowthPlan,
} from './growthGoal';

const TODAY = '2026-11-18';

const entry = (id: string, date: string, kind: GrowthEntry['kind'], text: string): GrowthEntry => ({
  id,
  date,
  weekStart: date,
  kind,
  text,
});

describe('growthSteps', () => {
  it('starts with the closed 90-day plan, then diary goals in progress with their source', () => {
    const plan: GrowthPlan = {
      status: 'closed',
      closedAt: '2026-03-01T10:00:00.000Z',
      tasks: [{ completed: true }, { completed: true }],
    };
    const goals = [
      {
        id: 'g1',
        title: 'Вторая команда — платформа',
        startDate: '2026-03-03',
        dueDate: '2026-12-31',
        parentGoalId: null,
      },
      {
        id: 'g2',
        title: 'Подзадача',
        startDate: '2026-03-03',
        dueDate: '2026-12-31',
        parentGoalId: 'g1',
      },
      {
        id: 'g3',
        title: 'Бюджет направления',
        startDate: '2026-01-10',
        dueDate: '2026-06-30',
        parentGoalId: null,
      },
    ];
    expect(growthSteps(plan, goals, TODAY)).toEqual([
      { title: 'План 90 дней закрыт', sub: '1 марта', state: 'done', source: 'из плана 30-60-90' },
      {
        title: 'Вторая команда — платформа',
        sub: 'до 31 декабря',
        state: 'now',
        source: 'цель в дневнике от 3 марта',
      },
      {
        title: 'Бюджет направления',
        sub: 'срок прошёл 30 июня',
        state: 'next',
        source: 'цель в дневнике от 10 января',
      },
    ]);
  });

  it('shows an open plan with its progress', () => {
    const plan: GrowthPlan = {
      status: 'active',
      closedAt: null,
      tasks: [{ completed: true }, { completed: false }, { completed: false }],
    };
    expect(growthSteps(plan, [], TODAY)).toEqual([
      {
        title: 'План 90 дней',
        sub: 'выполнено 1 из 3 задач',
        state: 'now',
        source: 'из плана 30-60-90',
      },
    ]);
  });

  it('is empty without plan and goals', () => {
    expect(growthSteps(null, [], TODAY)).toEqual([]);
  });
});

describe('growthArguments', () => {
  it('takes the newest diary results, at most five', () => {
    const entries = [
      entry('e1', '2026-01-03', 'result', 'Выпуск релиза: с 14 до 5 дней'),
      entry('e2', '2026-02-20', 'result', 'Наняли 2 разработчиков в срок'),
      entry('e3', '2026-02-21', 'problem', 'Сорвали срок'),
      ...Array.from({ length: 5 }, (_, i) =>
        entry(`r${i}`, `2025-0${i + 1}-01`, 'result', `Итог ${i}`),
      ),
    ];
    const args = growthArguments(entries);
    expect(args).toHaveLength(5);
    expect(args[0]).toEqual({
      id: 'e2',
      text: 'Наняли 2 разработчиков в срок',
      date: '2026-02-20',
      weekStart: '2026-02-20',
      source: 'Дневник, 20 февраля',
    });
    expect(args.map((item) => item.id)).not.toContain('e3');
  });
});

describe('GROWTH_GOALS', () => {
  it('has the four kinds of the screen', () => {
    expect(GROWTH_GOALS).toEqual(['promotion', 'raise', 'other_role', 'stay']);
  });
});
