import { describe, expect, it, vi } from 'vitest';
import {
  LIST_DATE_PERIODS,
  dateFacet,
  filteredFacetSteps,
  filteredFacetsOf,
  type FacetRow,
} from './listFilterFacets';

const NOW = Date.parse('2026-11-20T10:00:00Z');
const START = Date.parse('2026-11-20T00:00:00Z');
const DAY = 86_400_000;

function row(input: {
  readonly at: number;
  readonly location?: string;
  readonly isRemote?: boolean;
  readonly workFormat?: FacetRow['cluster']['workFormat'];
  readonly firstOnly?: boolean;
}): FacetRow {
  const iso = new Date(input.at).toISOString();
  return {
    cluster: {
      canonicalLocation: input.location,
      isRemote: input.isRemote,
      workFormat: input.workFormat,
      firstObservedAt: iso,
      sources: input.firstOnly ? [] : [{ observedAt: iso }],
    },
  };
}

describe('filteredFacetsOf (B729)', () => {
  const rows = [
    row({ at: NOW, location: ' Москва ', workFormat: 'office' }),
    row({ at: START - 3 * DAY, location: 'Москва', isRemote: true }),
    row({ at: START - 20 * DAY, location: 'Берлин', workFormat: 'hybrid', firstOnly: true }),
    row({ at: START - 60 * DAY, location: '' }),
    row({ at: START - 200 * DAY, location: 'Берлин', workFormat: 'office' }),
  ];

  it('counts places by trimmed location and remote rows apart', () => {
    const facets = filteredFacetsOf(rows);
    expect(facets.remote).toBe(1);
    expect(facets.places).toEqual([
      { location: 'Берлин', count: 2 },
      { location: 'Москва', count: 2 },
    ]);
  });

  it('counts formats like the list filter', () => {
    const formats = Object.fromEntries(
      filteredFacetsOf(rows).formats.map(({ id, count }) => [id, count]),
    );
    expect(formats).toMatchObject({ office: 2, hybrid: 1, remote: 1 });
  });

  it('counts periods from the start of the candidate day', () => {
    const { observed } = filteredFacetsOf(rows);
    expect(dateFacet(observed, START)).toEqual([
      { id: 'today', count: 1 },
      { id: '7', count: 2 },
      { id: '30', count: 3 },
      { id: '90', count: 4 },
    ]);
    expect(LIST_DATE_PERIODS.map(({ id }) => id)).toEqual(['today', '7', '30', '90']);
  });

  it('a row exactly at the period edge is inside', () => {
    expect(dateFacet([START - 7 * DAY], START)).toContainEqual({ id: '7', count: 1 });
    expect(dateFacet([START - 7 * DAY - 1], START)).toContainEqual({ id: '7', count: 0 });
  });

  it('skips rows without a readable date', () => {
    const broken: FacetRow = { cluster: { firstObservedAt: 'не дата', sources: [] } };
    expect(filteredFacetsOf([broken]).observed).toEqual([]);
  });
});

describe('filteredFacetSteps (B702)', () => {
  const rows = Array.from({ length: 620 }, (_, index) =>
    row({ at: NOW - index * DAY, location: `Город ${index % 90}`, isRemote: index % 3 === 0 }),
  );

  it('gives the same counts in pieces', () => {
    const steps = filteredFacetSteps(rows);
    let turns = 0;
    let step = steps.next();
    for (; !step.done; step = steps.next()) turns += 1;
    expect(step.value).toEqual(filteredFacetsOf(rows));
    expect(turns).toBeGreaterThan(10);
  });

  it('does not build a collator per comparison: the place sort held the loop on prod', () => {
    const compare = vi.spyOn(String.prototype, 'localeCompare');
    filteredFacetsOf(rows);
    expect(compare).not.toHaveBeenCalled();
    compare.mockRestore();
  });
});
