import { describe, expect, it } from 'vitest';
import { buildMemo, memoText, type MemoInput } from './memoModel';

function input(over: Partial<MemoInput> = {}): MemoInput {
  return {
    title: 'Руководитель платформы · Арка Холдинг',
    meta: ['12 ноября, 15:00', 'видеозвонок с техническим директором'],
    questions: [
      { id: 'q1', question: 'Почему уходите?' },
      { id: 'q2', question: 'Как переводили платформу на Kubernetes?' },
    ],
    paragraphs: [
      { questionId: 'q2', field: 'result', text: 'Сервис не останавливался.', sourceFactId: 'f' },
      {
        questionId: 'q2',
        field: 'situation',
        text: 'В 2024 году переводили платформу.',
        sourceFactId: 'f',
      },
    ],
    floor: 'от 500 000 ₽',
    askThem: ['Почему открыта позиция?'],
    ...over,
  };
}

describe('buildMemo', () => {
  it('assembles the memo from stored answers in STAR order, without inventing missing ones', () => {
    const memo = buildMemo(input());
    expect(memo.sections.map((section) => section.title)).toEqual([
      'Ответы',
      'Ожидания по зарплате',
      'Спросите сами',
    ]);
    expect(memo.sections[0]?.items).toEqual([
      { title: 'Почему уходите?', text: 'Ответа пока нет' },
      {
        title: 'Как переводили платформу на Kubernetes?',
        text: 'В 2024 году переводили платформу. Сервис не останавливался.',
      },
    ]);
  });

  it('leaves out sections that have nothing stored', () => {
    const memo = buildMemo(input({ floor: null, askThem: [] }));
    expect(memo.sections.map((section) => section.title)).toEqual(['Ответы']);
  });

  it('copies as plain text with the interview header first', () => {
    const text = memoText(buildMemo(input({ questions: [], floor: null })));
    expect(text).toBe(
      [
        'Руководитель платформы · Арка Холдинг',
        '12 ноября, 15:00 · видеозвонок с техническим директором',
        '',
        'Спросите сами',
        '— Почему открыта позиция?',
      ].join('\n'),
    );
  });
});
