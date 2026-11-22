import { describe, expect, it } from 'vitest';
import {
  goalContextHash,
  goalTaskSuggestionInstructions,
  goalTaskUserMessage,
  groundSuggestion,
  normalizeTaskText,
  parseGoalTaskAnswer,
  suggestionDueDate,
  type GoalSuggestionContext,
  type GoalTaskSuggestionInput,
} from './goalTaskSuggestion';

const context: GoalSuggestionContext = {
  goal: {
    title: 'Закрыть 2 вакансии в команду',
    startDate: '2026-12-01',
    dueDate: '2027-02-28',
    risk: 'at_risk',
    indicators: [{ title: 'Закрыто вакансий', unit: 'шт', target: 2, latest: 0 }],
  },
  measurements: [{ date: '2027-01-03', value: 0, comment: '1 финал перенесён' }],
  tasks: [{ title: 'Созвон с отделом найма о воронке', dueDate: '2027-01-10', completed: false }],
  entries: [{ date: '2026-12-29', text: 'Финальное интервью перенесли на 12 января.' }],
};
const input = (patch: Partial<GoalTaskSuggestionInput> = {}): GoalTaskSuggestionInput => ({
  today: '2027-01-05',
  context,
  skipped: [],
  ...patch,
});
const answer = (task: string | null, dueDate: string | null = null) => ({ task, dueDate });

describe('B743: проверка подсказки задачи по цели', () => {
  it('нормальный ответ проходит как есть, точка в конце снимается', () => {
    expect(
      groundSuggestion(
        answer('Описание второй вакансии в повестку 14 января.', '2027-01-12'),
        input(),
      ),
    ).toEqual({
      text: 'Описание второй вакансии в повестку 14 января',
      dueDate: '2027-01-12',
    });
  });

  it('пустой текст, null и слишком длинный текст отклоняются', () => {
    expect(groundSuggestion(answer(null), input())).toBeNull();
    expect(groundSuggestion(answer('   '), input())).toBeNull();
    expect(groundSuggestion(answer('а'.repeat(91)), input())).toBeNull();
    expect(groundSuggestion(answer('а'.repeat(90)), input())?.text).toHaveLength(90);
  });

  it('срок раньше сегодня или позже срока цели отбрасывается, задача остаётся', () => {
    expect(
      groundSuggestion(answer('Подготовить повестку', '2027-01-04'), input())?.dueDate,
    ).toBeNull();
    expect(
      groundSuggestion(answer('Подготовить повестку', '2027-03-01'), input())?.dueDate,
    ).toBeNull();
    expect(groundSuggestion(answer('Подготовить повестку', '2027-01-05'), input())?.dueDate).toBe(
      '2027-01-05',
    );
    expect(groundSuggestion(answer('Подготовить повестку', '2027-02-28'), input())?.dueDate).toBe(
      '2027-02-28',
    );
    expect(
      groundSuggestion(answer('Подготовить повестку', '2027-02-30'), input())?.dueDate,
    ).toBeNull();
  });

  it('дубль задачи цели отклоняется: регистр, ё, пробелы и знаки не важны', () => {
    expect(groundSuggestion(answer('созвон  с отделом найма о воронке!'), input())).toBeNull();
    const withYo = input({
      context: {
        ...context,
        tasks: [{ title: 'Передать всё ёмкое ТЗ', dueDate: '2027-01-10', completed: true }],
      },
    });
    expect(groundSuggestion(answer('Передать все емкое тз'), withYo)).toBeNull();
  });

  it('короткая подстрока чужой задачи не считается дублем, длинная — считается', () => {
    expect(groundSuggestion(answer('Созвон'), input())?.text).toBe('Созвон');
    expect(
      groundSuggestion(answer('Созвон с отделом найма о воронке и бюджете'), input()),
    ).toBeNull();
    const short = input({
      context: {
        ...context,
        tasks: [{ title: 'Звонок', dueDate: '2027-01-10', completed: false }],
      },
    });
    expect(groundSuggestion(answer('Звонок директору по бюджету'), short)?.text).toBe(
      'Звонок директору по бюджету',
    );
  });

  it('дубль пропущенной раньше подсказки отклоняется', () => {
    expect(
      groundSuggestion(
        answer('Описание второй вакансии в повестку'),
        input({ skipped: ['Описание второй вакансии в повестку.'] }),
      ),
    ).toBeNull();
  });

  it('нормализация', () => {
    expect(normalizeTaskText('  Ёлка,  «Тест»!  ')).toBe('елка тест');
  });

  it('форма ответа модели проверяется, неверная дата становится null', () => {
    expect(parseGoalTaskAnswer({ task: 'Подготовить', dueDate: '2027-01-10' })).toEqual({
      task: 'Подготовить',
      dueDate: '2027-01-10',
    });
    expect(parseGoalTaskAnswer({ task: null, dueDate: null })).toEqual({
      task: null,
      dueDate: null,
    });
    expect(parseGoalTaskAnswer({ task: 'Подготовить', dueDate: 'завтра' })?.dueDate).toBeNull();
    expect(parseGoalTaskAnswer({ dueDate: null })).toBeNull();
    expect(parseGoalTaskAnswer('текст')).toBeNull();
    expect(parseGoalTaskAnswer(null)).toBeNull();
  });

  it('хеш входа меняется вместе с данными цели и не зависит от даты и пропущенных', () => {
    const base = goalContextHash(context);
    expect(goalContextHash({ ...context })).toBe(base);
    expect(goalContextHash({ ...context, entries: [] })).not.toBe(base);
    expect(
      goalContextHash({ ...context, tasks: [{ ...context.tasks[0]!, completed: true }] }),
    ).not.toBe(base);
  });

  it('срок по умолчанию: названный, через неделю, не позже цели, не в прошлом', () => {
    expect(suggestionDueDate('2027-01-12', '2027-01-05', '2027-02-28')).toBe('2027-01-12');
    expect(suggestionDueDate(null, '2027-01-05', '2027-02-28')).toBe('2027-01-12');
    expect(suggestionDueDate(null, '2027-01-05', '2027-01-08')).toBe('2027-01-08');
    expect(suggestionDueDate(null, '2027-03-05', '2027-02-28')).toBe('2027-03-05');
  });

  it('инструкция и сообщение: даты, схема, данные цели', () => {
    expect(goalTaskSuggestionInstructions('2027-01-05')).toContain('2027-01-05');
    const message = goalTaskUserMessage(input({ skipped: ['Что-то'] }));
    expect(message).toContain('Закрыть 2 вакансии в команду');
    expect(message).toContain('"skipped":["Что-то"]');
  });
});
