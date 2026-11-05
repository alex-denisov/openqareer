import { describe, expect, it } from 'vitest';
import type { VacancyFitView } from '../../shared/vacancyFit';
import { compareFitRelevance, exactRoleTest } from './matchedFitRelevance';

const view = (percent: number, total = 10, blocked = false) =>
  ({
    state: 'ready',
    result: {
      status: 'assessed',
      dataState: 'known',
      coveragePercent: percent,
      coverage: { total },
      ...(blocked ? { conditionBlocks: ['x'] } : {}),
    },
  }) as unknown as VacancyFitView;

const ROLES = ['Chief Technology Officer', 'Head of IT Service Management', 'VP of Operations'];
const order = (rows: [string, VacancyFitView | undefined][], roles = ROLES) => {
  const isExact = exactRoleTest(roles);
  return [...rows]
    .sort(([t1, v1], [t2, v2]) =>
      compareFitRelevance({ title: t1, view: v1 }, { title: t2, view: v2 }, isExact),
    )
    .map(([title]) => title);
};

describe('exactRoleTest', () => {
  const exact = exactRoleTest(ROLES);
  it('takes another name of the same top role', () => {
    expect(exact('Технический директор (CTO)')).toBe(true);
    expect(exact('Vice President of Operations')).toBe(true);
  });
  it('does not take a neighbour that only shares the function or two words', () => {
    expect(exact('Руководитель отдела эксплуатации')).toBe(false);
    expect(exactRoleTest(['Head of AI'])('Head of Support')).toBe(false);
  });
  it('keeps the grade and widens only a role the dictionary knows', () => {
    const frontend = exactRoleTest(['Senior Frontend Developer']);
    expect(frontend('Senior Frontend Engineer')).toBe(true);
    expect(frontend('Junior FrontEnd Developer')).toBe(false);
    expect(
      exactRoleTest(['Head of Customer Support'])('Руководитель службы технической поддержки'),
    ).toBe(true);
  });
  it('works for any profession', () => {
    const accountant = exactRoleTest(['Главный бухгалтер']);
    expect(accountant('Главный бухгалтер')).toBe(true);
    expect(accountant('Бухгалтер')).toBe(false);
    const nurse = exactRoleTest(['Старшая медицинская сестра']);
    expect(nurse('Медсестра')).toBe(false);
  });
});

describe('compareFitRelevance', () => {
  it('puts the role above a higher percent of the same colour', () => {
    expect(
      order([
        ['Руководитель отдела эксплуатации', view(100)],
        ['Chief Technology Officer', view(91)],
      ]),
    ).toEqual(['Chief Technology Officer', 'Руководитель отдела эксплуатации']);
  });
  it('never crosses a colour: a strong other role stays above a good own role', () => {
    expect(
      order([
        ['Chief Technology Officer', view(79)],
        ['Руководитель отдела эксплуатации', view(80)],
      ]),
    ).toEqual(['Руководитель отдела эксплуатации', 'Chief Technology Officer']);
  });
  it('puts 3 of 3 below 10 of 10 within the same role', () => {
    expect(
      order(
        [
          ['CTO thin', view(100, 3)],
          ['CTO full', view(90, 10)],
        ],
        ['CTO thin', 'CTO full'],
      ),
    ).toEqual(['CTO full', 'CTO thin']);
  });
  it('keeps blocked rows last and uncounted rows after counted, role first among them', () => {
    expect(
      order([
        ['Chief Technology Officer', view(100, 10, true)],
        ['Руководитель отдела эксплуатации', undefined],
        ['Технический директор', undefined],
        ['Другая', view(12)],
      ]),
    ).toEqual([
      'Другая',
      'Технический директор',
      'Руководитель отдела эксплуатации',
      'Chief Technology Officer',
    ]);
  });
});
