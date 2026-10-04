import { describe, expect, it } from 'vitest';
import { archiveReasonLabel } from './archiveReasonLabel';

describe('archiveReasonLabel', () => {
  it('uses human-readable reasons and the configured stale period', () => {
    expect(archiveReasonLabel('candidate')).toBe('Вы перенесли в архив');
    expect(archiveReasonLabel('vacancy_closed')).toBe('Вакансия закрыта');
    expect(archiveReasonLabel('stale', 45)).toBe('Нет движения 45 дней');
    expect(archiveReasonLabel('stale', 1)).toBe('Нет движения 1 день');
    expect(archiveReasonLabel('unknown')).toBe('Причина не записана');
    expect(archiveReasonLabel(null)).toBe('Причина не записана');
  });
});
