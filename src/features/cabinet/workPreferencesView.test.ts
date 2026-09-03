import { describe, expect, it } from 'vitest';
import { describeWorkPreferences } from './workPreferencesView';
import {
  scoreWorkPreferences,
  WORK_PREFERENCE_KEY_VERSION,
  WORK_PREFERENCE_TASKS,
} from '../../../shared/workPreferences';

const separating = [
  { taskId: 'monday', optionId: 'monday-queue' },
  { taskId: 'shift', optionId: 'shift-schedule' },
  { taskId: 'end-of-shift', optionId: 'end-of-shift-schedule' },
  { taskId: 'half-done', optionId: 'half-done-finish' },
  { taskId: 'week', optionId: 'week-build' },
  { taskId: 'worse', optionId: 'worse-research-nothing' },
  { taskId: 'day-done', optionId: 'day-done-numbers' },
  { taskId: 'explain', optionId: 'explain-form' },
  { taskId: 'people', optionId: 'people-grow' },
  { taskId: 'easier', optionId: 'easier-touch' },
  { taskId: 'one-hour', optionId: 'one-hour-persuade' },
  { taskId: 'first-day', optionId: 'first-day-open' },
];

function view(input: {
  answers?: typeof separating;
  excluded?: Parameters<typeof scoreWorkPreferences>[0]['excluded'];
  keyVersion?: string;
}) {
  const result = scoreWorkPreferences({
    answers: input.answers ?? separating,
    excluded: input.excluded ?? [],
  });
  return describeWorkPreferences({
    result: input.keyVersion ? { ...result, keyVersion: input.keyVersion as never } : result,
    completedAt: '2026-09-03T16:00:00.000Z',
    currentKeyVersion: WORK_PREFERENCE_KEY_VERSION,
  });
}

describe('describeWorkPreferences', () => {
  it('называет, из чего собран результат: выборы, виды работы, дата', () => {
    expect(view({}).basisLine).toBe('12 выборов · 8 видов работы · 3 сентября');
  });

  it('у каждого верхнего вида работы есть знаменатель', () => {
    const top = view({}).top;
    expect(top).toHaveLength(3);
    for (const count of top) {
      expect(count.basis).toMatch(/из \d+, когда это предлагалось/u);
      expect(count.total).toBeGreaterThan(0);
    }
  });

  it('отказ различить называет словами и не печатает порядок', () => {
    const flat = WORK_PREFERENCE_TASKS.slice(0, 3).map((task) => ({
      taskId: task.id,
      optionId: task.options[0].id,
    }));
    const result = view({ answers: flat });

    expect(result.top).toEqual([]);
    expect(result.undecidedLine).toContain('не разделили направления');
  });

  it('исключённые виды работы называет и объясняет их судьбу', () => {
    expect(view({ excluded: ['ЗФ'] }).excludedLine).toContain('Замысел и форма');
  });

  it('результат по прежним формулировкам заданий не выдаёт за нынешний', () => {
    expect(view({ keyVersion: 'work-preferences-pairs-v0' }).staleLine).toContain(
      'посчитан по прежним формулировкам',
    );
  });

  it('на нынешней версии ключа лишнего не пишет', () => {
    expect(view({}).staleLine).toBeNull();
    expect(view({}).undecidedLine).toBeNull();
  });
});
