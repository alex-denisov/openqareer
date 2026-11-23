import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ count: 0 }));
vi.mock('./careerRoleKey', async (importOriginal) => {
  const real = await importOriginal<typeof import('./careerRoleKey')>();
  return {
    ...real,
    sameCareerRole: (title: string, role: string) => {
      calls.count += 1;
      return real.sameCareerRole(title, role);
    },
  };
});

const { vacancyInCareerRole } = await import('./techDirectorSignal');
const { countMatchedVacanciesByRole } = await import('./vacancyRoleCounts');
const { buildMatchedVacancyFacets } = await import('./matchedVacancyFacets');
const { sameCareerRole } =
  await vi.importActual<typeof import('./careerRoleKey')>('./careerRoleKey');

const row = (id: string, title: string) => ({ cluster: { id, canonicalTitle: title } });
const TITLES = [
  'CTO',
  'Chief Operating Officer',
  'Head of IT Infrastructure',
  'Senior Backend Developer',
];
const ROLES = ['CTO', 'COO', 'Head of IT'];

describe('vacancyInCareerRole: совпадение названия с ролью — одно на процесс (B770)', () => {
  it('повторная сборка с теми же названиями роль не пересчитывает, ответы прежние', () => {
    calls.count = 0;
    const first = TITLES.flatMap((title, i) =>
      ROLES.map((role) => vacancyInCareerRole(row(`a${i}`, title), role)),
    );
    const parsed = calls.count;
    const second = TITLES.flatMap((title, i) =>
      ROLES.map((role) => vacancyInCareerRole(row(`b${i}`, title), role)),
    );
    expect(parsed).toBe(TITLES.length * ROLES.length);
    expect(calls.count).toBe(parsed);
    expect(second).toEqual(first);
    expect(first).toEqual(
      TITLES.flatMap((title) => ROLES.map((role) => sameCareerRole(title, role))),
    );
  });

  it('счёт ролей и сводка одинаковы при пустом и заполненном кэше', () => {
    // Свои названия: кэш общий на процесс, первый тест уже заполнил «CTO» и «Chief Operating Officer».
    const rows = [
      'CTO, fintech',
      'Технический директор',
      'Chief Transformation Officer (CTO)',
      'Chief Operating Officer (COO)',
      'Руководитель ИТ',
      'CIO / ИТ-директор',
      'VP of Engineering',
      'Директор по информационным технологиям',
    ].map((title, i) => ({
      cluster: {
        id: `e${i}`,
        canonicalTitle: title,
        canonicalCompany: 'Acme',
        isRemote: false,
        skills: [],
        primaryUrl: '',
        sources: [],
        firstObservedAt: '',
        lastSeenAt: '',
        descriptionSummary: '',
        status: 'active' as const,
        vacanciesCount: 1,
      },
      explanation: {
        clusterId: `e${i}`,
        roleMatch: 'target' as const,
        levelMatch: 'unknown' as const,
        matchingPoints: [],
        missingPoints: [],
        summary: '',
        calculatedAt: '',
      },
    }));
    const roles = ['CTO', 'COO', 'Chief Information Officer', 'VP of Engineering / Technology'];
    calls.count = 0;
    const cold = [countMatchedVacanciesByRole(rows, roles), buildMatchedVacancyFacets(rows, roles)];
    const coldCalls = calls.count;
    const warm = [countMatchedVacanciesByRole(rows, roles), buildMatchedVacancyFacets(rows, roles)];
    expect(warm).toEqual(cold);
    expect(calls.count).toBe(coldCalls);
    expect(coldCalls).toBe(rows.length * roles.length);
    expect(cold[0]).toMatchObject({ CTO: expect.any(Number) });
  });
});
