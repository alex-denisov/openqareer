import { describe, expect, it, vi } from 'vitest';
import type { GoalTaskSuggestionInput } from '../domain/goalTaskSuggestion';
import { buildGoalTaskSuggester } from './goalTaskSuggester';

const KEYS = { openrouter: 'sk-or-test-key-long-enough' };
const INPUT: GoalTaskSuggestionInput = {
  today: '2027-01-05',
  skipped: [],
  context: {
    goal: {
      title: 'Цель',
      startDate: '2026-12-01',
      dueDate: '2027-02-28',
      risk: 'on_track',
      indicators: [],
    },
    measurements: [],
    tasks: [],
    entries: [],
  },
};

const reply = (content: unknown, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status,
  });

describe('buildGoalTaskSuggester', () => {
  it('без ключей подсказок нет', () => {
    expect(buildGoalTaskSuggester({})).toBeUndefined();
  });

  it('первая ступень отвечает: запрос с запретом сбора данных и малым бюджетом ответа', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return reply({ task: 'Подготовить повестку', dueDate: '2027-01-12' });
    });
    const suggester = buildGoalTaskSuggester({
      providerCredentials: KEYS,
      fetchImpl: fetchImpl as never,
    });
    expect(await suggester!.suggest(INPUT)).toEqual({
      task: 'Подготовить повестку',
      dueDate: '2027-01-12',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(bodies[0]).toMatchObject({
      model: 'deepseek/deepseek-v4.1-flash',
      max_tokens: 600,
      provider: { data_collection: 'deny' },
    });
  });

  it('ответ «задачи нет» — тоже ответ, следующая ступень не зовётся', async () => {
    const fetchImpl = vi.fn(async () => reply({ task: null, dueDate: null }));
    const suggester = buildGoalTaskSuggester({
      providerCredentials: KEYS,
      fetchImpl: fetchImpl as never,
    });
    expect(await suggester!.suggest(INPUT)).toEqual({ task: null, dueDate: null });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('отказ или мусор первой ступени — вторая; обе отказали — null', async () => {
    const failures = vi.fn();
    const models: string[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model as string;
      models.push(model);
      return models.length === 1
        ? reply({}, 500)
        : reply({ task: 'Подготовить повестку', dueDate: null });
    });
    const suggester = buildGoalTaskSuggester({
      providerCredentials: KEYS,
      fetchImpl: fetchImpl as never,
      onStageFailure: failures,
    });
    expect(await suggester!.suggest(INPUT)).toEqual({
      task: 'Подготовить повестку',
      dueDate: null,
    });
    expect(models).toEqual(['deepseek/deepseek-v4.1-flash', 'z-ai/glm-5.3-flash']);
    expect(failures).toHaveBeenCalledTimes(1);

    const broken = buildGoalTaskSuggester({
      providerCredentials: KEYS,
      fetchImpl: (async () => reply({ nonsense: true })) as never,
      onStageFailure: failures,
    });
    expect(await broken!.suggest(INPUT)).toBeNull();
    expect(failures).toHaveBeenCalledTimes(3);
  });
});
