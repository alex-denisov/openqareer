import { describe, expect, it, vi } from 'vitest';
import type { ProposedRole } from '../../shared/roleProposals';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import {
  careerTimeZone,
  countRolesLikeTheList,
  startOfDayIn,
  withinLastDays,
} from './careerRoleCounts';

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
    expect(withinLastDays([row('COO', '2026-10-20T00:00:00.000Z')], 30, NOW)).toHaveLength(1);
    expect(withinLastDays([row('COO', '2026-10-19T23:59:00.000Z')], 30, NOW)).toHaveLength(0);
    expect(withinLastDays([row('COO', 'не дата')], 30, NOW)).toHaveLength(0);
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

  it('начало дня — в поясе кандидата, как у «Сегодня»; без пояса UTC', () => {
    const late = new Date('2026-11-19T22:30:00.000Z');
    expect(new Date(startOfDayIn(late, 'Europe/Moscow')).toISOString()).toBe(
      '2026-11-19T21:00:00.000Z',
    );
    expect(new Date(startOfDayIn(late, 'UTC')).toISOString()).toBe('2026-11-19T00:00:00.000Z');
    const early = new Date('2026-11-19T03:00:00.000Z');
    expect(new Date(startOfDayIn(early, 'America/New_York')).toISOString()).toBe(
      '2026-11-18T05:00:00.000Z',
    );
    expect(
      withinLastDays([row('COO', '2026-10-20T21:00:00.000Z')], 30, late, 'Europe/Moscow'),
    ).toHaveLength(1);
    expect(
      withinLastDays([row('COO', '2026-10-20T20:59:00.000Z')], 30, late, 'Europe/Moscow'),
    ).toHaveLength(0);
  });

  it('пояс из запроса — только IANA, иначе UTC', () => {
    expect(careerTimeZone({ tz: 'Europe/Moscow' })).toBe('Europe/Moscow');
    expect(careerTimeZone({ tz: 'Mars/Olympus' })).toBe('UTC');
    expect(careerTimeZone({ tz: ['Europe/Moscow'] })).toBe('UTC');
    expect(careerTimeZone(undefined)).toBe('UTC');
  });

  it('B702-2: граница дня считается один раз на список, а не на строку', () => {
    const Original = Intl.DateTimeFormat;
    let built = 0;
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (...args) {
      built += 1;
      return new Original(...args);
    } as typeof Intl.DateTimeFormat);
    const rows = Array.from({ length: 200 }, () => row('COO', '2026-11-10T00:00:00.000Z'));
    expect(withinLastDays(rows, 30, NOW, 'Europe/Moscow')).toHaveLength(200);
    vi.restoreAllMocks();
    expect(built).toBeLessThan(10);
  });
});
