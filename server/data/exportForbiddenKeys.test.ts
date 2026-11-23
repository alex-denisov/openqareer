import { describe, expect, it } from 'vitest';
import { forbiddenExportKeys, strippedExportPaths, withoutForbiddenKeys } from './exportForbiddenKeys';

const exported = {
  turns: [
    {
      id: 't1',
      idempotencyKey: 'k',
      content: 'Мой token и password от старого сайта',
      provenance: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, model: 'm' },
    },
  ],
  tracker: { careerCommands: [{ commandId: 'c', authorization: { approvalId: 'a' }, idempotency: { key: 'k' } }] },
  careerDiary: { taskSuggestions: [{ text: 'Шаг', inputHash: 'h' }] },
  other: { usage: { inputTokens: 1 } },
  list: ['a', 1, null],
};

describe('B738: запретные поля выгрузки', () => {
  it('убирает служебные поля на любой глубине и не трогает значения', () => {
    const clean = withoutForbiddenKeys(exported);
    expect(forbiddenExportKeys(clean)).toEqual([]);
    expect(clean).toEqual({
      turns: [
        {
          id: 't1',
          content: 'Мой token и password от старого сайта',
          provenance: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, model: 'm' },
        },
      ],
      tracker: { careerCommands: [{ commandId: 'c' }] },
      careerDiary: { taskSuggestions: [{ text: 'Шаг' }] },
      other: { usage: {} },
      list: ['a', 1, null],
    });
    expect(exported.turns[0]).toHaveProperty('idempotencyKey');
  });

  it('счётчики токенов разрешены только по точным путям', () => {
    expect(strippedExportPaths(exported)).toEqual([
      'careerDiary.taskSuggestions[].inputHash',
      'other.usage.inputTokens',
      'tracker.careerCommands[].authorization',
      'tracker.careerCommands[].idempotency',
      'turns[].idempotencyKey',
    ]);
  });
});
