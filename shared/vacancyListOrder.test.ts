import { describe, expect, it } from 'vitest';
import type { VacancyFitView } from './vacancyFit';
import { compareListed, listedDay, type ListedMatch } from './vacancyListOrder';

const view = (percent: number): VacancyFitView =>
  ({
    state: 'ready',
    requirements: [],
    result: {
      status: 'assessed',
      dataState: 'known',
      coveragePercent: percent,
      coverage: { matched: 1, total: 5, unknown: 0 },
    },
  }) as unknown as VacancyFitView;

function row(id: string, percent: number | null, date: string, extra: object = {}): ListedMatch {
  return {
    cluster: {
      id,
      canonicalTitle: 'CTO',
      primaryUrl: `https://example.test/${id}`,
      status: 'active',
      sources: [{ observedAt: date }],
      ...extra,
    },
    explanation: percent === null ? {} : { fitView: view(percent) },
  } as unknown as ListedMatch;
}

const ids = (rows: readonly ListedMatch[], dir: 'asc' | 'desc' = 'desc') =>
  [...rows]
    .sort((a, b) => compareListed(a, b, dir))
    .map((item) => (item.cluster as { id?: string }).id);

const ROWS = [
  row('old-100', 100, '2026-11-01'),
  row('new-80', 80, '2026-11-25'),
  row('dead-100', 100, '2026-11-25', { deadLink: true }),
  row('none', null, '2026-11-25'),
  row('new-100', 100, '2026-11-20'),
  row('low', 20, '2026-11-24'),
];

describe('порядок подборки (B789)', () => {
  it('процент, затем дата; без процента после посчитанных, мёртвые внизу', () => {
    expect(ids(ROWS)).toEqual(['new-100', 'old-100', 'new-80', 'low', 'none', 'dead-100']);
    expect(ids([...ROWS].reverse())).toEqual(ids(ROWS));
  });

  it('по возрастанию: низкий процент сверху, остальное там же', () => {
    expect(ids(ROWS, 'asc')).toEqual(['low', 'new-80', 'new-100', 'old-100', 'none', 'dead-100']);
  });

  it('не проходящие по условию — одной группой внизу, выше мёртвых, в том же порядке (02.11)', () => {
    const blocked = (id: string, percent: number): ListedMatch => {
      const item = row(id, percent, '2026-11-25');
      const fitView = item.explanation.fitView!;
      const result = {
        ...fitView.result!,
        conditionBlocks: [{ requirementId: 'c', text: 'US only', quote: 'Vilnius' }],
      };
      return { ...item, explanation: { fitView: { ...fitView, result } } };
    };
    const all = [blocked('b-60', 60), blocked('b-100', 100), ...ROWS];
    const tail = ['none', 'b-100', 'b-60', 'dead-100'];
    expect(ids(all)).toEqual(['new-100', 'old-100', 'new-80', 'low', ...tail]);
  });

  it('равные процент и дата — по id, как бы строки ни пришли', () => {
    const equal = ['c', 'a', 'b'].map((id) => row(id, 80, '2026-11-25'));
    expect(ids(equal)).toEqual(['a', 'b', 'c']);
    expect(ids([...equal].reverse())).toEqual(['a', 'b', 'c']);
  });

  it('день строки — в поясе кандидата', () => {
    const late = row('a', 1, '2026-11-24T22:30:00.000Z');
    expect(listedDay(late, 'UTC')).toBe('2026-11-24');
    expect(listedDay(late, 'Europe/Moscow')).toBe('2026-11-25');
  });
});
