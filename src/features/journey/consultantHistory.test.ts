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
