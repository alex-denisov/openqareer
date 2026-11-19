import { describe, expect, it } from 'vitest';
import type { CareerDiaryGoal, CareerDiaryMeasurement } from '../../shared/careerDiary';
import { buildDay30Check, buildResults90, withoutEmployerFigures, type GoalTrack } from './careerDiaryCheckpoints';

const goal = (id: string, over: Partial<CareerDiaryGoal> = {}): CareerDiaryGoal => ({
  id,
  title: 'Срок релиза',
  type: 'team',
  horizon: 'quarter',
  startDate: '2026-12-01',
  dueDate: '2027-02-28',
  unit: 'дней',
  baselineValue: 14,
  targetValue: 7,
  valueSource: 'candidate_entered',
  parentGoalId: null,
  isPrimary: false,
  createdAt: '2026-12-01T10:00:00.000Z',
  updatedAt: '2026-12-01T10:00:00.000Z',
  ...over,
});
const measure = (goalId: string, value: number | string, measuredAt: string): CareerDiaryMeasurement => ({
  id: `${goalId}-${measuredAt}`, goalId, value, measuredAt, note: null, source: 'candidate_entered', createdAt: `${measuredAt}T10:00:00.000Z`,
});
const track = (g: CareerDiaryGoal, values: Array<[number | string, string]>, archived = false): GoalTrack => ({
  goal: g,
  measurements: values.map(([value, at]) => measure(g.id, value, at)),
  archived,
});
const workplace = { id: 'w1', startDate: '2026-12-01', title: 'Руководитель разработки' };
const people = { workplaceId: 'w1', total: 9, withoutMeeting: 0, nextMeeting: null, groups: [] };
const tasks = [
  { stage: 'days_1_30', completed: true },
  { stage: 'days_1_30', completed: true },
  { stage: 'days_31_60', completed: false },
] as const;

describe('buildDay30Check', () => {
  it('свод команды, результата и плана; без отставаний сигнала нет', () => {
    const release = track(goal('g1', { isPrimary: true }), [[14, '2026-12-01'], [7, '2026-12-28']]);
    const check = buildDay30Check({ workplace, people, tasks, goals: [release], asOf: '2026-12-30', sentOn: null });
    expect(check.dueOn).toBe('2026-12-30');
    expect(check.facts).toEqual([
      { area: 'team', label: 'Команда', value: 'Встречи с 9 из 9 человек' },
      { area: 'result', label: 'Результат', value: 'Срок релиза: 14 → 7 дней' },
      { area: 'plan', label: 'План', value: 'Задачи первого месяца: 2 из 2' },
    ]);
    expect(check.signal).toBeNull();
    expect(check.letter).toContain('Как вы оцениваете мой старт?');
  });

  it('один сигнал: сначала отстающий результат, затем люди без встречи', () => {
    const slow = track(goal('g1', { isPrimary: true }), [[14, '2026-12-01'], [14, '2026-12-28']]);
    const map = { ...people, withoutMeeting: 3 };
    const behind = buildDay30Check({ workplace, people: map, tasks, goals: [slow], asOf: '2027-01-20', sentOn: null });
    expect(behind.signal).toEqual({ area: 'result', text: 'Срок релиза отстаёт от плана' });
    expect(behind.letter).toContain('Нужен ваш совет: срок релиза отстаёт от плана.');
    const fine = track(goal('g1', { isPrimary: true }), [[14, '2026-12-01'], [7, '2026-12-28']]);
    const lonely = buildDay30Check({ workplace, people: map, tasks, goals: [fine], asOf: '2026-12-30', sentOn: '2026-12-31' });
    expect(lonely.signal).toEqual({ area: 'team', text: 'Без встречи — 3 человека' });
    expect(lonely.sentOn).toBe('2026-12-31');
  });
});

describe('buildResults90', () => {
  it('цели за 90 дней: достигнутые, отстающие и без замеров; архив не входит', () => {
    const release = track(goal('g1', { targetValue: 7 }), [[14, '2026-12-01'], [5, '2027-01-03']]);
    const incidents = track(goal('g2', { title: 'Инциденты после релиза', unit: 'в месяц', baselineValue: 6, targetValue: 2 }), [[6, '2026-12-01'], [3, '2027-02-01']]);
    const hiring = track(goal('g3', { title: 'Нанять 2 разработчиков', unit: 'чел.', baselineValue: 0, targetValue: 2 }), []);
    const old = track(goal('g4', { title: 'Старая цель' }), [[1, '2026-12-01']], true);
    const results = buildResults90({ workplace, goals: [release, incidents, hiring, old], asOf: '2027-03-01' });
    expect(results.periodFrom).toBe('2026-12-01');
    expect(results.periodTo).toBe('2027-02-28');
    expect(results.items).toEqual([
      { goalId: 'g1', title: 'Срок релиза', line: 'с 14 до 5 дней', status: 'done' },
      { goalId: 'g2', title: 'Инциденты после релиза', line: 'с 6 до 3 в месяц, цель — 2', status: 'behind' },
      { goalId: 'g3', title: 'Нанять 2 разработчиков', line: 'замеров нет', status: 'open' },
    ]);
    expect(results.resumeText).toBe('Руководитель разработки: за первые 90 дней — срок релиза.');
    expect(results.resumeText).not.toMatch(/14|5 дней/u);
    expect(results.talkText).toContain('Прошу зафиксировать критерии итоговой оценки');
  });

  it('без достигнутых целей текста для резюме нет', () => {
    const results = buildResults90({ workplace, goals: [], asOf: '2027-03-01' });
    expect(results.items).toEqual([]);
    expect(results.resumeText).toBeNull();
    expect(results.talkText).toBeNull();
  });
});

describe('withoutEmployerFigures', () => {
  it('убирает деньги, проценты и крупные суммы, оставляет смысл', () => {
    expect(withoutEmployerFigures('Выручка 120 млн ₽, рост на 15 %')).toBe('Выручка, рост');
    expect(withoutEmployerFigures('Снизить отток до 3%')).toBe('Снизить отток');
    expect(withoutEmployerFigures('Нанять 2 разработчиков')).toBe('Нанять 2 разработчиков');
    expect(withoutEmployerFigures('Бюджет 10 миллионов рублей')).toBe('Бюджет');
    expect(withoutEmployerFigures('Продажи 2.5M USD')).toBe('Продажи');
    expect(withoutEmployerFigures('Экономия 5 тысяч долларов в месяц')).toBe('Экономия в месяц');
    expect(withoutEmployerFigures('MAU 500k, конверсия 20 percent')).toBe('MAU, конверсия');
    expect(withoutEmployerFigures('Чек 50 евро и 50 EUR')).toBe('Чек и');
    expect(withoutEmployerFigures('Выручка $3 млн')).toBe('Выручка');
  });
});
