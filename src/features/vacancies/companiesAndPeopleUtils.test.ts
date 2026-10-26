import { describe, expect, it } from 'vitest';
import {
  companyLocationLabel,
  companySourceSummary,
  groupCompanyPeople,
  isContactImportStale,
} from './companiesAndPeopleUtils';
import type { ConnectionCirclePath, VacancyConnectionCircles } from './vacancyLetterApi';

const REFERENCE_NOW = Date.parse('2026-10-14T10:00:00.000Z');

describe('isContactImportStale', () => {
  it('marks an import older than fourteen days as stale', () => {
    expect(isContactImportStale('2026-09-12T10:00:00.000Z', REFERENCE_NOW)).toBe(true);
  });

  it('keeps a fourteen-day-old import current and ignores unknown dates', () => {
    expect(isContactImportStale('2026-09-30T10:00:00.000Z', REFERENCE_NOW)).toBe(false);
    expect(isContactImportStale(null, REFERENCE_NOW)).toBe(false);
    expect(isContactImportStale('bad date', REFERENCE_NOW)).toBe(false);
  });
});

describe('companySourceSummary', () => {
  it('ставит склоняемые названия площадок в родительный падеж (B445-r1)', () => {
    expect(
      companySourceSummary([
        { name: 'Telegram-каналы', observedAt: '2026-10-02T10:00:00.000Z' },
        { name: 'SuperJob', observedAt: '2026-10-02T10:00:00.000Z' },
        { name: 'Greenhouse', observedAt: '2026-10-06T10:00:00.000Z' },
      ]),
    ).toBe('данные с Telegram-каналов, SuperJob и Greenhouse, 06.10.2026');
  });

  it('names every platform once and dates the summary by the latest observation', () => {
    expect(
      companySourceSummary([
        { name: 'hh.ru', observedAt: '2026-10-02T10:00:00.000Z' },
        { name: 'LinkedIn', observedAt: '2026-10-06T10:00:00.000Z' },
        { name: 'hh.ru', observedAt: '2026-10-05T10:00:00.000Z' },
        { name: 'LinkedIn', observedAt: '2026-10-01T10:00:00.000Z' },
      ]),
    ).toBe('данные с hh.ru и LinkedIn, 06.10.2026');
  });

  it('lists three platforms with commas and stays silent without sources', () => {
    expect(
      companySourceSummary([
        { name: 'Amazon', observedAt: '2026-10-21T10:00:00.000Z' },
        { name: 'Amazon', observedAt: '2026-10-21T10:00:00.000Z' },
        { name: 'hh.ru', observedAt: '2026-10-20T10:00:00.000Z' },
        { name: 'LinkedIn', observedAt: 'bad' },
      ]),
    ).toBe('данные с Amazon, hh.ru и LinkedIn, 21.10.2026');
    expect(companySourceSummary([])).toBeNull();
  });
});

const person = (id: string, fullName: string, roleTitle: string | null = null) => ({
  id,
  fullName,
  roleTitle,
  companyName: 'Вектор Банк',
});

function circles(
  vacancyId: string,
  paths: readonly ConnectionCirclePath[],
): VacancyConnectionCircles {
  return {
    vacancyId,
    companyKey: 'k',
    companyName: 'Вектор Банк',
    vacancyTitle: 'Head of Platform',
    circles: ([1, 2, 3] as const).map((circle) => ({
      circle,
      state: 'available' as const,
      message: '',
      paths: paths.filter((path) => path.circle === circle),
    })),
    linkedinImport: {
      state: 'imported',
      importedAt: '2026-09-12T10:00:00.000Z',
      importedCount: 412,
    },
  };
}

describe('groupCompanyPeople', () => {
  const me = person('me', 'Алексей');
  const maria = person('r1', 'Мария Орлова', 'Рекрутёр');
  const igor = person('c2', 'Игорь Н.', 'CTO');
  const sergey = person('r2', 'Сергей В.', 'Руководитель платежей');
  const direct: ConnectionCirclePath = {
    id: 'circle-1:r1:c1',
    circle: 1,
    path: [me, maria],
    recipient: maria,
    evidence: ['Писала вам 28.09 про роль Head of Platform'],
    strength: 'direct',
    source: 'linkedin_import',
    nextStep: 'write_known_contact',
  };
  const intro: ConnectionCirclePath = {
    id: 'circle-2:c2:r2',
    circle: 2,
    path: [me, igor, sergey],
    recipient: sergey,
    evidence: ['Бывший коллега', 'Связь с адресатом указана в источнике контакта.'],
    strength: 'weak',
    source: 'linkedin_import',
    nextStep: 'ask_for_introduction',
  };
  const cold = (vacancyId: string): ConnectionCirclePath => ({
    id: 'circle-3:vacancy:' + vacancyId,
    circle: 3,
    path: [me, person('vacancy:' + vacancyId, 'Вектор Банк')],
    recipient: person('vacancy:' + vacancyId, 'Вектор Банк'),
    evidence: ['Холодный отклик по вакансии; ничего не отправлено.'],
    strength: 'unknown',
    source: 'cold',
    nextStep: 'cold_application',
  });

  it('turns per-vacancy paths into one card per person and keeps cold outreach as one action', () => {
    const result = groupCompanyPeople([
      circles('v1', [direct, intro, cold('v1')]),
      circles('v2', [direct, cold('v2')]),
      circles('v3', [cold('v3')]),
    ]);
    expect(result.people.map((item) => [item.fullName, item.circle, item.vacancyId])).toEqual([
      ['Мария Орлова', 1, 'v1'],
      ['Сергей В.', 2, 'v1'],
    ]);
    expect(result.people[0]).toMatchObject({
      roleTitle: 'Рекрутёр',
      relation: 'Писала вам 28.09 про роль Head of Platform',
      source: 'импорт контактов LinkedIn, 12.09.2026',
      action: 'Написать знакомому',
    });
    expect(result.people[1]).toMatchObject({
      relation: 'Знаком с вашим контактом Игорь Н.',
      source: 'общий контакт, импорт 12.09.2026',
      action: 'Попросить представить',
    });
    expect(result.coldVacancyId).toBe('v1');
  });

  it('keeps the closer circle when the same person is reachable twice', () => {
    const viaIntro = { ...intro, recipient: maria, path: [me, igor, maria] };
    const result = groupCompanyPeople([circles('v1', [viaIntro]), circles('v2', [direct])]);
    expect(result.people).toHaveLength(1);
    expect(result.people[0]).toMatchObject({ circle: 1, vacancyId: 'v2' });
  });

  it('returns nobody and no cold vacancy for empty responses', () => {
    expect(groupCompanyPeople([])).toEqual({ people: [], coldVacancyId: null });
  });
});

describe('companyLocationLabel', () => {
  it('keeps one place as is', () => {
    expect(companyLocationLabel('Bengaluru, IND')).toBe('Bengaluru, IND');
  });

  it('folds a long list of places into the first one and a count', () => {
    expect(companyLocationLabel('Argentina; Austria; Belgium; Brazil')).toBe('Argentina и ещё 3');
  });

  it('translates a bare source count such as Workday «5 Locations»', () => {
    expect(companyLocationLabel('5 Locations')).toBe('5 локаций');
    expect(companyLocationLabel('2 locations')).toBe('2 локации');
    expect(companyLocationLabel('Remote; 21 Locations')).toBe('Remote и ещё 1');
  });

  it('names an unknown place', () => {
    expect(companyLocationLabel(null)).toBe('Место неизвестно');
    expect(companyLocationLabel('  ')).toBe('Место неизвестно');
  });
});
