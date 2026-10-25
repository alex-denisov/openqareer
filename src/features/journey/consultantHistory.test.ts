import { describe, expect, it } from 'vitest';
import { consultantTurns } from './consultantHistory';

describe('consultant history (B266 S3)', () => {
  it('drops import announcements, old random-id rows included, and keeps real turns', () => {
    const turns = consultantTurns([
      { id: 'resume-import:abc', role: 'user', content: 'Импорт: профиль LinkedIn' },
      {
        id: '8d4ef6ea-4ea3-4b58-bb37-410b406181d3',
        role: 'user',
        content: 'Импорт: PDF-резюме «cv.pdf»',
      },
      { id: 'u1', role: 'user', content: 'Какие 3 шага сделать сегодня?' },
      { id: 'a1', role: 'assistant', content: 'Импорт: это слово в ответе не фильтруется.' },
    ]);
    expect(turns.map((turn) => turn.id)).toEqual(['u1', 'a1']);
  });
});

describe('consultantTurns: repeated question in a row (B563)', () => {
  const q = 'Почему «NewStore» подходит? Разбери вакансию «CTO».';
  it('keeps the first question and answer, hides the repeats that follow', () => {
    const messages = [
      { id: '1', role: 'user', content: q },
      { id: '2', role: 'assistant', content: 'Ответ 1' },
      { id: '3', role: 'user', content: q },
      { id: '4', role: 'assistant', content: 'Ответ 2' },
      { id: '5', role: 'user', content: ` ${q} ` },
      { id: '6', role: 'assistant', content: 'Ответ 3' },
      { id: '7', role: 'user', content: 'Другой вопрос' },
      { id: '8', role: 'assistant', content: 'Ответ 4' },
      { id: '9', role: 'user', content: q },
    ];
    expect(consultantTurns(messages).map((m) => m.id)).toEqual(['1', '2', '7', '8', '9']);
  });

  it('a burst of repeats sent before any answer keeps the first answer that came', () => {
    const messages = [
      { id: '1', role: 'user', content: q },
      { id: '2', role: 'user', content: q },
      { id: '3', role: 'user', content: q },
      { id: '4', role: 'assistant', content: 'Ответ 1' },
      { id: '5', role: 'user', content: q },
      { id: '6', role: 'assistant', content: 'Ответ 2' },
    ];
    expect(consultantTurns(messages).map((m) => m.id)).toEqual(['1', '4']);
  });
});
