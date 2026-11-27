import { describe, expect, it } from 'vitest';
import type { CareerDiaryAdaptationStageView, CareerDiaryAdaptationStepView } from '../../../../shared/careerDiaryCards';
import { addDays, PROGRESS_TAG, STEP_TAG, dayHeading, peopleCount, dayLabel, probationLine, rangeLabel, stageForDate, stepSub, stepTag } from './adaptationModel';

const stage = (over: Partial<CareerDiaryAdaptationStageView>): CareerDiaryAdaptationStageView => ({
  stage: 'days_31_60',
  title: null,
  goalId: null,
  tasks: [],
  tasksTotal: 0,
  tasksDone: 0,
  status: 'ahead',
  ...over,
});
const step = (id: CareerDiaryAdaptationStepView['id']): CareerDiaryAdaptationStepView => ({
  id,
  groups: [],
  tasksTotal: 0,
  tasksDone: 0,
  status: 'ahead',
});
const details = { firstMeeting: null, relocated: null };

describe('даты', () => {
  it('день, сдвиг и промежуток по-русски', () => {
    expect(dayLabel('2026-12-01')).toBe('1 декабря');
    expect(addDays('2026-12-01', -17)).toBe('2026-11-14');
    expect(rangeLabel('2026-11-14', '2026-11-30')).toBe('14–30 ноября');
    expect(rangeLabel('2026-11-28', '2026-12-13')).toBe('28 ноября – 13 декабря');
  });

  it('этап по сроку задачи, как у сервера', () => {
    expect(stageForDate('2026-12-01', '2026-11-30')).toBe('prep');
    expect(stageForDate('2026-12-01', '2026-12-30')).toBe('days_1_30');
    expect(stageForDate('2026-12-01', '2027-01-08')).toBe('days_31_60');
    expect(stageForDate('2026-12-01', '2027-02-20')).toBe('days_61_90');
  });
});

describe('B801: проверка на 30-й день в списке шагов', () => {
  const check = { workplaceId: 'w', dueOn: '2026-12-30', facts: [], signal: { area: 'plan' as const, text: 'x' }, letter: '', sentOn: null };
  const step = (status: 'active' | 'ahead') => ({ id: 'day_30_check' as const, groups: [], tasksTotal: 0, tasksDone: 0, status });
  const details = { firstMeeting: null, relocated: null };

  it('сигнал виден датой и меткой; до срока и без сигнала — обычная метка', () => {
    expect(stepSub(step('active'), details, null, check)).toBe('30 декабря · 1 сигнал');
    expect(stepTag(step('active'), check)).toEqual(['part', 'есть сигнал']);
    expect(stepSub(step('ahead'), details, null, check)).toBe('30 декабря');
    expect(stepTag(step('ahead'), check)).toEqual(['miss', 'впереди']);
    expect(stepTag(step('active'), { ...check, signal: null })).toEqual(['part', 'идёт']);
    expect(stepTag(step('active'), null)).toEqual(['part', 'идёт']);
  });
});

describe('peopleCount', () => {
  it('склоняет «человек»', () => {
    expect([1, 2, 5, 12, 22, 18].map(peopleCount)).toEqual(['1 человек', '2 человека', '5 человек', '12 человек', '22 человека', '18 человек']);
  });
});

describe('заголовки', () => {
  it('день из 90 с целью текущего этапа; до выхода — сколько осталось', () => {
    const active = stage({ status: 'active', title: 'первый заметный результат команды' });
    expect(dayHeading(34, [active])).toBe('День 34 из 90: цель — первый заметный результат команды');
    expect(dayHeading(120, [])).toBe('День 90 из 90');
    expect(dayHeading(-5, [])).toBe('До выхода 5 дн.');
  });

  it('испытательный срок в ⓘ только при известной дате', () => {
    expect(probationLine({ probation: { endsOn: null, reviewer: null } })).toBeNull();
    expect(probationLine({ probation: { endsOn: '2027-03-01', reviewer: 'Ирина Лаврова' } })).toBe(
      'Решение по испытательному сроку — 1 марта; оценивает Ирина Лаврова.',
    );
  });

  it('строка шага: люди без встречи, день первой встречи, переезд', () => {
    const people = { workplaceId: 'w', total: 18, withoutMeeting: 4, nextMeeting: null, groups: [] };
    expect(stepSub(step('people_map'), details, people)).toBe('18 человек · 4 без встречи');
    expect(stepSub(step('people_map'), details, null)).toBe('с кем и как часто встречаться');
    const met = { ...details, firstMeeting: { heldOn: '2026-12-02' } as never };
    expect(stepSub(step('first_meeting'), met, null)).toBe('2 декабря · ожидания и критерии 90 дней');
    expect(stepSub(step('settling'), { ...details, relocated: false }, null)).toBe('переезда не было · документы и банк');
  });
});

describe('метки этапов и шагов (B645-2)', () => {
  it('«впереди» — приглушённая метка tag miss, как в макете d01', () => {
    expect(PROGRESS_TAG.ahead).toEqual(['miss', 'впереди']);
    expect(STEP_TAG.ahead).toEqual(['miss', 'впереди']);
  });
});
