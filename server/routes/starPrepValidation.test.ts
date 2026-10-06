import { describe, expect, it } from 'vitest';
import { putStarPrepSchema } from './starPrepValidation';

const ok = { questionId: 'q1', field: 'action', text: 'Запустил миграцию', sourceFactId: 'fact-1' };

describe('putStarPrepSchema', () => {
  it('принимает абзац с источником и пустой набор', () => {
    expect(putStarPrepSchema.safeParse({ paragraphs: [ok] }).success).toBe(true);
    expect(putStarPrepSchema.safeParse({ paragraphs: [] }).success).toBe(true);
  });

  it('отклоняет абзац без источника или с пустым источником', () => {
    const { sourceFactId: _drop, ...noSource } = ok;
    expect(putStarPrepSchema.safeParse({ paragraphs: [noSource] }).success).toBe(false);
    expect(putStarPrepSchema.safeParse({ paragraphs: [{ ...ok, sourceFactId: '  ' }] }).success).toBe(false);
  });

  it('отклоняет пустой текст, чужое поле и дубль поля вопроса', () => {
    expect(putStarPrepSchema.safeParse({ paragraphs: [{ ...ok, text: ' ' }] }).success).toBe(false);
    expect(putStarPrepSchema.safeParse({ paragraphs: [{ ...ok, field: 'plan' }] }).success).toBe(false);
    expect(putStarPrepSchema.safeParse({ paragraphs: [ok, ok] }).success).toBe(false);
  });
});
