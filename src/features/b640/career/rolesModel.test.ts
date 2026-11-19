import { describe, expect, it } from 'vitest';
import type { ProposedRole } from '../../../../shared/roleProposals';
import {
  buildRoleRows,
  compareCheckTag,
  searchStrip,
  skillStripText,
  type RoleRow,
} from './rolesModel';

function observed(
  id: string,
  title: string,
  sampleSize: number,
  wage: { min: number; max: number; sampleSize: number } | null,
  extra: Partial<ProposedRole> = {},
): ProposedRole {
  return {
    id,
    title,
    origin: 'model',
    reason: null,
    evidenceRefs: [],
    family: null,
    confirmation: {
      state: 'observed',
      sampleSize,
      observedFrom: '2026-10-11',
      observedTo: '2026-11-10T09:00:00.000Z',
      sources: [{ source: 'hh', count: sampleSize }],
      repeatedRequirements: ['Управление командой', 'Бюджет', 'Найм'],
      matchedRequirementNames: ['Управление командой'],
      ...(wage ? { wage } : {}),
    },
    ...extra,
  } as unknown as ProposedRole;
}

const notFound = (id: string, title: string): ProposedRole =>
  ({
    id,
    title,
    origin: 'model',
    reason: null,
    evidenceRefs: [],
    family: null,
    confirmation: { state: 'not-found' },
  }) as ProposedRole;

const ROLES = [
  observed('r2', 'Технический продакт-менеджер', 41, {
    min: 350_000,
    max: 420_000,
    sampleSize: 24,
  }),
  notFound('r4', 'Head of Platform'),
  observed('r1', 'Руководитель разработки', 64, { min: 380_000, max: 520_000, sampleSize: 96 }),
  observed('r3', 'Директор по разработке', 31, null),
];

describe('buildRoleRows', () => {
  it('сортирует по числу вакансий, роль без вакансий внизу с прочерком', () => {
    const rows = buildRoleRows(ROLES, ['Руководитель разработки'], []);
    expect(rows.map((row) => row.title)).toEqual([
      'Руководитель разработки',
      'Технический продакт-менеджер',
      'Директор по разработке',
      'Head of Platform',
    ]);
    expect(rows[3]?.vacancies).toBeNull();
  });

  it('вилка с источником, числом вакансий с зарплатой и датой', () => {
    const [first] = buildRoleRows(ROLES, [], []);
    expect(first?.wage).toBe('380–520 тыс. ₽');
    expect(first?.wageNote).toBe('hh.ru, 96 вакансий, 10.11');
  });

  it('без зарплат вилку не показывает', () => {
    const rows = buildRoleRows(ROLES, [], []);
    const director = rows.find((row) => row.id === 'r3');
    expect(director?.wage).toBeNull();
    expect(director?.wageNote).toBe('нет данных о зарплатах');
  });

  it('роль поиска отмечена; остальные — по вашему опыту', () => {
    const rows = buildRoleRows(ROLES, ['руководитель разработки'], []);
    expect(rows.find((row) => row.id === 'r1')?.origin).toBe('search');
    expect(rows.find((row) => row.id === 'r2')?.origin).toBe('experience');
  });

  it('роль поиска, которой нет среди предложенных, тоже в списке', () => {
    const rows = buildRoleRows(ROLES, ['Архитектор решений'], []);
    const own = rows.find((row) => row.title === 'Архитектор решений');
    expect(own).toMatchObject({ origin: 'search', vacancies: null, wage: null });
  });

  it('роль, добавленная кандидатом, — «вы добавили»', () => {
    const rows = buildRoleRows(
      [observed('r9', 'Аналитик', 12, null, { origin: 'candidate' })],
      [],
      [],
    );
    expect(rows[0]?.origin).toBe('own');
  });

  it('подтверждения и пробелы — для сравнения ролей', () => {
    const [first] = buildRoleRows(ROLES, [], []);
    expect(first?.confirms).toBe('Управление командой');
    expect(first?.lacks).toBe('Бюджет, Найм');
    expect(first?.check).toBeNull();
  });

  it('проверка навыков пройдена: сколько подтверждено из скольких', () => {
    const rows = buildRoleRows(
      ROLES,
      [],
      [
        {
          roleTitle: 'Руководитель разработки',
          completedAt: '2026-11-09',
          confirmedSkills: ['Бюджет'],
        },
      ],
    );
    const first = rows.find((row) => row.id === 'r1');
    expect(first?.check).toEqual({ confirmed: 2, total: 3 });
    expect(first?.lacks).toBe('Найм');
  });
});

describe('searchStrip', () => {
  const rows = buildRoleRows(ROLES, ['Руководитель разработки'], []);

  it('одна роль: название и число вакансий', () => {
    expect(searchStrip(rows, ['Руководитель разработки'])).toEqual({
      title: 'Руководитель разработки',
      count: '64 вакансии · по подборке за 30 дней',
    });
  });

  it('несколько ролей: первая и «ещё N»', () => {
    expect(
      searchStrip(rows, ['Руководитель разработки', 'Директор по разработке', 'Head of Platform'])
        ?.title,
    ).toBe('Руководитель разработки и ещё 2');
  });

  it('роль не выбрана — null', () => {
    expect(searchStrip(rows, [])).toBeNull();
  });

  it('без числа вакансий подпись пустая', () => {
    const own = buildRoleRows([], ['Архитектор'], []);
    expect(searchStrip(own, ['Архитектор'])?.count).toBeNull();
  });
});

describe('skillStripText', () => {
  it('склоняет число навыков', () => {
    expect(skillStripText(1)).toBe('Проверьте 1 навык — точнее подбор');
    expect(skillStripText(3)).toBe('Проверьте 3 навыка — точнее подбор');
    expect(skillStripText(5)).toBe('Проверьте 5 навыков — точнее подбор');
  });
});

describe('compareCheckTag', () => {
  const row = (check: RoleRow['check']) => ({ check }) as RoleRow;
  it('пройдена с числом и не начата', () => {
    expect(compareCheckTag(row({ confirmed: 5, total: 6 }))).toEqual({
      text: 'пройдена · 5 из 6',
      ok: true,
    });
    expect(compareCheckTag(row(null))).toEqual({ text: 'не начата', ok: false });
  });
});
