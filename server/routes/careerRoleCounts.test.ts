import { describe, expect, it } from 'vitest';
import type { ProposedRole } from '../../shared/roleProposals';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { countRolesLikeTheList, observedWithinDays } from './careerRoleCounts';

const NOW = new Date('2026-11-19T12:00:00.000Z');

function row(title: string, observedAt: string, roleMatch = 'function'): MatchedVacancyItem {
  return {
    cluster: {
      canonicalTitle: title,
      firstObservedAt: observedAt,
      sources: [{ observedAt }],
      skills: [],
    },
    explanation: { roleMatch },
  } as unknown as MatchedVacancyItem;
}

const role = (title: string): ProposedRole =>
  ({
    id: title,
    title,
    origin: 'model',
    reason: null,
    evidenceRefs: [],
    family: null,
    confirmation: { state: 'observed', sampleSize: 999 },
  }) as unknown as ProposedRole;

describe('B726: число роли «Карьеры» = строкам «Подборки» по ссылке', () => {
  it('30 дней — от начала сегодняшнего дня, как фильтр «Дата»', () => {
    expect(observedWithinDays(row('COO', '2026-10-20T00:00:00.000Z'), 30, NOW)).toBe(true);
    expect(observedWithinDays(row('COO', '2026-10-19T23:59:00.000Z'), 30, NOW)).toBe(false);
    expect(observedWithinDays(row('COO', 'не дата'), 30, NOW)).toBe(false);
  });

  it('считает по строкам списка тем же признаком роли и за 30 дней', () => {
    const rows = [
      ...Array.from({ length: 9 }, () => row('COO', '2026-11-10T00:00:00.000Z')),
      row('COO', '2026-09-01T00:00:00.000Z'),
      row('COO', '2026-11-10T00:00:00.000Z', 'none'),
      row('Head of Platform', '2026-11-10T00:00:00.000Z'),
    ];
    const [coo] = countRolesLikeTheList([role('COO')], rows, { skills: [], now: NOW });
    expect(coo!.confirmation).toMatchObject({ state: 'observed', sampleSize: 9 });
  });

  it('роль без строк — «не найдено», а не прежнее число пула', () => {
    const [lost] = countRolesLikeTheList([role('CFO')], [], { skills: [], now: NOW });
    expect(lost!.confirmation).toEqual({ state: 'not-found' });
  });
});
