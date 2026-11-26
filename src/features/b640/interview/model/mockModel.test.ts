import { describe, expect, it } from 'vitest';
import { criteriaRows, mockEyebrow, sessionChoice } from './mockModel';

describe('sessionChoice', () => {
  const session = (
    status: string,
    applicationId: string | null,
    questionTypes = ['behavioral'],
  ) => ({
    status,
    applicationId,
    questionTypes,
  });

  it('resumes an unfinished session of this response, starts otherwise', () => {
    expect(sessionChoice(null, 'r1')).toBe('start');
    expect(sessionChoice(session('completed', 'r1'), 'r1')).toBe('start');
    expect(sessionChoice(session('active', 'r1'), 'r1')).toBe('resume');
    expect(sessionChoice(session('paused', 'r1'), 'r1')).toBe('resume');
    expect(sessionChoice(session('active', 'r2'), 'r1')).toBe('other');
  });

  it('B780: задача System Design этого отклика (i03) в пробном интервью не продолжается — её сначала закончить', () => {
    expect(sessionChoice(session('active', 'r1', ['system_design']), 'r1')).toBe('other');
  });
});

describe('criteriaRows', () => {
  it('names the STAR criteria in plain words; points become «есть», «уточнить», «добавить»', () => {
    const rows = criteriaRows({
      rubric: 'star',
      points: 4,
      maxPoints: 8,
      criteria: {
        situation: { points: 2, reason: 'Контекст ситуации описан.' },
        task: { points: 1, reason: 'Уточните цель.' },
        action: { points: 1, reason: 'Опишите свои шаги.' },
        result: { points: 0, reason: 'Не указан результат.' },
      },
    });
    expect(rows).toEqual([
      {
        key: 'situation',
        title: 'Ситуация и ваша роль',
        sub: 'Контекст ситуации описан.',
        tag: 'есть',
        ok: true,
      },
      { key: 'task', title: 'Задача', sub: 'Уточните цель.', tag: 'уточнить', ok: false },
      {
        key: 'action',
        title: 'Что сделали вы',
        sub: 'Опишите свои шаги.',
        tag: 'уточнить',
        ok: false,
      },
      {
        key: 'result',
        title: 'Результат назван',
        sub: 'Не указан результат.',
        tag: 'добавить',
        ok: false,
      },
    ]);
  });
});

describe('mockEyebrow', () => {
  it('shows the company and the question number', () => {
    expect(mockEyebrow('Арка Холдинг', 2, 6)).toBe(
      'Пробное интервью · Арка Холдинг · вопрос 3 из 6',
    );
    expect(mockEyebrow(null, 0, 6)).toBe('Пробное интервью · вопрос 1 из 6');
  });
});
