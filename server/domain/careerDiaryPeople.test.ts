import { describe, expect, it } from 'vitest';
import type { CareerDiaryPerson } from '../../shared/careerDiaryPeople';
import {
  buildPeopleMap,
  meetingTaskId,
  personInputSchema,
  stageForDate,
  withMeetingTask,
  withoutTask,
} from './careerDiaryPeople';
import type { PlanTask } from './careerDiaryAdaptationView';

const person = (id: string, over: Partial<CareerDiaryPerson> = {}): CareerDiaryPerson => ({
  id,
  name: '',
  role: 'Руководитель тестовых сред',
  group: 'Соседние команды',
  cadence: 'on_demand',
  headcount: 1,
  lastMetOn: null,
  meeting: null,
  createdAt: '2026-12-01T10:00:00.000Z',
  ...over,
});

const task = (id: string, over: Partial<PlanTask> = {}): PlanTask => ({
  id,
  title: 'Встреча',
  description: '',
  stage: 'days_1_30',
  category: 'people',
  dueDate: '2027-01-08',
  completed: false,
  source: 'candidate',
  ...over,
});

describe('personInputSchema', () => {
  it('принимает человека по роли и строку «Ещё 8 человек» без имени', () => {
    const { id: _id, meeting: _meeting, createdAt: _created, ...input } = person('a');
    expect(personInputSchema.safeParse(input).success).toBe(true);
    const bundle = { name: '', role: '', group: 'Команда', cadence: 'biweekly', headcount: 8, lastMetOn: null };
    expect(personInputSchema.safeParse(bundle).success).toBe(true);
  });

  it('не принимает пустую строку на одного человека и чужую периодичность', () => {
    const empty = { name: ' ', role: '', group: 'Команда', cadence: 'weekly', headcount: 1, lastMetOn: null };
    expect(personInputSchema.safeParse(empty).success).toBe(false);
    const odd = { ...empty, name: 'Илья', cadence: 'daily' };
    expect(personInputSchema.safeParse(odd).success).toBe(false);
  });
});

describe('stageForDate', () => {
  it('этап плана по дню от выхода', () => {
    expect(stageForDate('2026-12-01', '2026-11-25')).toBe('prep');
    expect(stageForDate('2026-12-01', '2026-12-01')).toBe('days_1_30');
    expect(stageForDate('2026-12-01', '2026-12-30')).toBe('days_1_30');
    expect(stageForDate('2026-12-01', '2026-12-31')).toBe('days_31_60');
    expect(stageForDate('2026-12-01', '2027-01-30')).toBe('days_61_90');
    expect(stageForDate('2026-12-01', '2027-06-01')).toBe('days_61_90');
  });
});

describe('withMeetingTask / withoutTask', () => {
  it('добавляет задачу «люди» и переносит её на новую дату, не трогая другие', () => {
    const other = task('other', { category: 'delivery' });
    const added = withMeetingTask([other], person('p1'), '2027-01-08', '2026-12-01');
    const id = meetingTaskId('p1');
    expect(added).toHaveLength(2);
    expect(added[1]).toMatchObject({
      id,
      title: 'Встреча: Руководитель тестовых сред',
      category: 'people',
      stage: 'days_31_60',
      dueDate: '2027-01-08',
      completed: false,
      source: 'candidate',
    });
    const moved = withMeetingTask(added, person('p1'), '2026-12-20', '2026-12-01');
    expect(moved).toHaveLength(2);
    expect(moved[1]).toMatchObject({ id, dueDate: '2026-12-20', stage: 'days_1_30' });
    expect(withoutTask(moved, id)).toEqual([other]);
    const named = withMeetingTask([], person('p2', { name: 'Илья', role: '', group: 'Команда' }), '2027-01-08', '2026-12-01');
    expect(named[0]!.title).toBe('Встреча: Команда');
  });
});

describe('buildPeopleMap', () => {
  it('группы по порядку, счёт людей и людей без встречи, ближайшая встреча', () => {
    const people = [
      person('boss', { name: 'Ирина Лаврова', group: 'Руководитель', lastMetOn: '2026-12-09' }),
      person('team', { name: 'Илья', group: 'Команда', lastMetOn: '2026-12-30' }),
      person('rest', { name: '', role: '', group: 'Команда', headcount: 8 }),
      person('tests', { meeting: { taskId: meetingTaskId('tests'), date: '2027-01-08' } }),
      person('ops', { role: 'Руководитель эксплуатации' }),
      person('done', { role: 'Руководитель ИБ', meeting: { taskId: meetingTaskId('done'), date: '2026-12-17' } }),
    ];
    const tasks = [
      task(meetingTaskId('tests')),
      task(meetingTaskId('done'), { dueDate: '2026-12-17', completed: true }),
    ];
    const map = buildPeopleMap('w1', people, tasks);
    expect(map.total).toBe(13);
    expect(map.withoutMeeting).toBe(9);
    expect(map.nextMeeting).toEqual({ personId: 'tests', date: '2027-01-08' });
    expect(map.groups.map((group) => [group.name, group.headcount])).toEqual([
      ['Руководитель', 1],
      ['Команда', 9],
      ['Соседние команды', 3],
    ]);
    const status = Object.fromEntries(map.groups.flatMap((g) => g.people).map((p) => [p.id, p.status]));
    expect(status).toEqual({ boss: 'met', team: 'met', rest: 'none', tests: 'scheduled', ops: 'none', done: 'met' });
    const done = map.groups[2]!.people.find((p) => p.id === 'done')!;
    expect(done.lastMetOn).toBe('2026-12-17');
  });

  it('встреча, чья задача удалена из плана, не считается назначенной', () => {
    const people = [person('gone', { meeting: { taskId: meetingTaskId('gone'), date: '2027-01-08' } })];
    const map = buildPeopleMap('w1', people, []);
    expect(map.groups[0]!.people[0]).toMatchObject({ status: 'none', meeting: null });
    expect(map.withoutMeeting).toBe(1);
    expect(map.nextMeeting).toBeNull();
  });
});
