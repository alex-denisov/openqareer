import { describe, expect, it } from 'vitest';
import {
  WORK_FAMILIES,
  WORK_PREFERENCE_KEY_VERSION,
  WORK_PREFERENCE_TASKS,
  scoreWorkPreferences,
  type WorkFamilyCode,
  type WorkPreferenceAnswer,
} from './workPreferences';

/** Ответы «всегда A» удобны для проверки подсчёта, а не для правдоподобия. */
function answersChoosing(family: WorkFamilyCode): WorkPreferenceAnswer[] {
  return WORK_PREFERENCE_TASKS.map((task) => ({
    taskId: task.id,
    // Выбираем вариант этого семейства, если он в задании есть, иначе первый.
    optionId: (task.options.find((option) => option.family === family) ?? task.options[0]).id,
  }));
}

describe('ключ заданий', () => {
  it('сбалансирован: каждый вид работы предлагается одинаковое число раз', () => {
    const offered = new Map<WorkFamilyCode, number>();
    for (const task of WORK_PREFERENCE_TASKS) {
      for (const option of task.options) {
        offered.set(option.family, (offered.get(option.family) ?? 0) + 1);
      }
    }

    expect(offered.size).toBe(WORK_FAMILIES.length);
    // Иначе доли несопоставимы: у одного семейства знаменатель больше.
    expect(new Set(offered.values()).size).toBe(1);
  });

  it('каждый вариант нагружает ровно одно семейство и описывает действие', () => {
    for (const task of WORK_PREFERENCE_TASKS) {
      expect(task.options).toHaveLength(2);
      for (const option of task.options) {
        expect(WORK_FAMILIES.some((family) => family.code === option.family)).toBe(true);
        expect(option.text.length).toBeGreaterThan(20);
      }
    }
  });

  it('версия ключа названа: смена формулировок меняет смысл сохранённых ответов', () => {
    expect(WORK_PREFERENCE_KEY_VERSION).toMatch(/^work-preferences-/u);
  });
});

describe('scoreWorkPreferences', () => {
  it('считает долю как «выбрано из предложено», без весов и без сводного балла', () => {
    const result = scoreWorkPreferences({
      answers: answersChoosing('ПП'),
      excluded: [],
    });

    const flow = result.counts.find((count) => count.family === 'ПП');
    expect(flow).toMatchObject({ value: 3, total: 3 });
    // Сводного балла нет вовсе: инструмент не оценивает человека.
    expect(result).not.toHaveProperty('score');
  });

  it('обратный ключ засчитывает противоположному семейству', () => {
    const reverse = WORK_PREFERENCE_TASKS.find((task) => task.reverseKeyed);
    expect(reverse).toBeDefined();
    if (!reverse) return;

    const result = scoreWorkPreferences({
      answers: [{ taskId: reverse.id, optionId: reverse.options[0].id }],
      excluded: [],
    });

    // «Что хуже» — выбранное это то, чего человек избегает.
    const chosen = reverse.options[0].family;
    expect(result.counts.find((count) => count.family === chosen)?.value).toBe(0);
    expect(result.counts.find((count) => count.family === reverse.options[1].family)?.value).toBe(1);
  });

  it('исключённые кандидатом виды работы не ранжируются вовсе', () => {
    const result = scoreWorkPreferences({
      answers: answersChoosing('ПП'),
      excluded: ['ПП'],
    });

    expect(result.ranked.map((count) => count.family)).not.toContain('ПП');
    expect(result.excluded).toEqual(['ПП']);
  });

  it('исключить можно не больше двух видов работы', () => {
    const result = scoreWorkPreferences({
      answers: answersChoosing('ПП'),
      excluded: ['ПП', 'РР', 'СП'],
    });
    expect(result.excluded).toEqual(['ПП', 'РР']);
  });

  it('отказывается ранжировать, когда ответы не разделили направления', () => {
    // Три ответа в три разных семейства: у первого и третьего поровну.
    const flat = WORK_PREFERENCE_TASKS.slice(0, 3).map((task) => ({
      taskId: task.id,
      optionId: task.options[0].id,
    }));

    const result = scoreWorkPreferences({ answers: flat, excluded: [] });

    expect(result.discriminates).toBe(false);
    expect(result.ranked).toEqual([]);
  });

  it('на разделяющих ответах отдаёт только края распределения', () => {
    // Два выраженных предпочтения по три выбора и остальные по одному:
    // именно так выглядит распределение, у которого есть края.
    const result = scoreWorkPreferences({
      answers: [
        { taskId: 'monday', optionId: 'monday-queue' }, // ПП
        { taskId: 'shift', optionId: 'shift-schedule' }, // ПП
        { taskId: 'end-of-shift', optionId: 'end-of-shift-schedule' }, // ПП
        { taskId: 'half-done', optionId: 'half-done-finish' }, // СП
        { taskId: 'week', optionId: 'week-build' }, // СП
        { taskId: 'worse', optionId: 'worse-research-nothing' }, // обратный ключ → СП
        { taskId: 'day-done', optionId: 'day-done-numbers' }, // РР
        { taskId: 'explain', optionId: 'explain-form' }, // ЗФ
        { taskId: 'people', optionId: 'people-grow' }, // ЗО
        { taskId: 'easier', optionId: 'easier-touch' }, // РМ
        { taskId: 'one-hour', optionId: 'one-hour-persuade' }, // ЛД
        { taskId: 'first-day', optionId: 'first-day-open' }, // НН
      ],
      excluded: [],
    });

    expect(result.discriminates).toBe(true);
    expect(result.counts.find((count) => count.family === 'ПП')).toMatchObject({
      value: 3,
      total: 3,
      basis: 'выбрали 3 раза из 3, когда это предлагалось',
    });
    // Середина распределения — шум, и показывать её ранжированной значит врать.
    expect(result.ranked).toHaveLength(3);
    expect(result.ranked.slice(0, 2).map((count) => count.family).sort()).toEqual([
      'ПП',
      'СП',
    ]);
  });

  it('неизвестное задание в ответах не ломает подсчёт и не считается', () => {
    const result = scoreWorkPreferences({
      answers: [{ taskId: 'no-such-task', optionId: 'no-such-option' }],
      excluded: [],
    });
    expect(result.counts.every((count) => count.value === 0)).toBe(true);
    expect(result.answered).toBe(0);
  });
});
