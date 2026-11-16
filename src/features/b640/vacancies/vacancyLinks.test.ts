import { describe, expect, it } from 'vitest';
import type { ApplicationView } from '../../applications/applicationsApi';
import { appliedOn, isSaved, parseShortDate, replaceApplication } from './vacancyLinks';

function application(patch: Partial<ApplicationView>): ApplicationView {
  return { id: 'a1', clusterId: 'c1', stage: 'saved', version: 1, ...patch } as ApplicationView;
}

describe('vacancyLinks: связь вакансии с карточкой отклика', () => {
  it('сохранённая — карточка стадии saved', () => {
    expect(isSaved(application({}))).toBe(true);
    expect(isSaved(application({ stage: 'applied' }))).toBe(false);
    expect(isSaved(undefined)).toBe(false);
  });

  it('отклик есть у стадий после «сохранено», кроме архива', () => {
    expect(appliedOn(application({ stage: 'applied' }))).toBe(true);
    expect(appliedOn(application({ stage: 'saved' }))).toBe(false);
    expect(appliedOn(application({ stage: 'archived' }))).toBe(false);
  });

  it('замена записи возвращает новый список', () => {
    const list = [application({})];
    const next = replaceApplication(list, application({ stage: 'archived', version: 2 }));
    expect(next).not.toBe(list);
    expect(next[0].stage).toBe('archived');
    expect(replaceApplication(list, application({ id: 'a2' }))).toHaveLength(2);
  });

  it('дата «дд.мм» — день текущего года, будущая дата уходит в прошлый год', () => {
    const now = new Date('2026-11-16T10:00:00Z');
    expect(parseShortDate('12.11', now)).toBe('2026-11-12T09:00:00.000Z');
    expect(parseShortDate('25.12', now)).toBe('2025-12-25T09:00:00.000Z');
    expect(parseShortDate('31.13', now)).toBeNull();
    expect(parseShortDate('31.02', now)).toBeNull();
    expect(parseShortDate('абв', now)).toBeNull();
  });
});
