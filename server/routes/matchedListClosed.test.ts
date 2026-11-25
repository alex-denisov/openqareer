import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { runSteps } from '../vacancies/yieldingSteps';
import { createPhaseTimer } from './matchedListPhases';
import { matchedListSteps, type MatchedListInput } from './matchedVacancyList';

const PLACES = ['Москва', 'Berlin, Germany', 'Алматы'];
const id = (n: number) => `src-hh-search:${n}`;
const rows = Array.from({ length: 300 }, (_, n) => ({
  cluster: {
    id: `cluster-${id(n)}`,
    canonicalTitle: 'Инженер',
    canonicalCompany: `Компания ${n}`,
    canonicalLocation: PLACES[n % 3],
    isRemote: n % 4 === 0,
    skills: [],
    sources: Array.from({ length: n === 0 ? 2 : 1 }, () => ({
      sourceId: 'src-hh-search',
      observedAt: '2026-11-01T00:00:00.000Z',
    })),
    lastSeenAt: '2026-11-01T00:00:00.000Z',
    firstObservedAt: '2026-11-01T00:00:00.000Z',
  },
  explanation: {
    clusterId: `cluster-${id(n)}`,
    roleMatch: 'target',
    requirements: { matched: 1, total: 5 },
    matchingPoints: [],
    missingPoints: [],
  },
})) as unknown as MatchedVacancyItem[];

function build(closed: readonly number[], filters: Record<string, unknown> = {}) {
  const empty = { region: [], level: [], source: [], role: [], place: [], offset: 0 };
  const input = {
    snapshot: rows,
    targetRoles: ['Инженер'],
    confirmedSkills: [],
    campaign: { regions: { value: [] }, remoteOnly: false },
    candidateStore: {
      getSnapshot: () => ({ memory: [] }),
      getCandidateWorkspace: () => undefined,
      decisionProfileRepo: { get: () => undefined },
      listVacancyDecisions: () => [],
    },
    candidateId: 'candidate-a',
    titleParseStore: { getByKey: () => undefined },
    filters: { ...empty, ...filters },
    sourceRegistry: [],
    order: (items: readonly MatchedVacancyItem[]) => [...items],
    closed: () => new Set(closed.map(id)),
  } as unknown as MatchedListInput;
  return runSteps(matchedListSteps(input, createPhaseTimer()));
}

describe('B797: снятые уходят из списка и из всех чисел', () => {
  it('площадка отказала, ничего не сверено: список не сжимается', () => {
    const list = build([]);
    expect(list.filtered).toHaveLength(300);
    expect(list.facets.total).toBe(300);
  });

  it('снятая с единственной площадки уходит, со второй площадкой остаётся', () => {
    const list = build([0, 1, 2]);
    expect(list.filtered.map((item) => item.cluster.id)).not.toContain(`cluster-${id(1)}`);
    expect(list.filtered).toHaveLength(298);
    expect(list.filtered[0]?.cluster.id).toBe(`cluster-${id(0)}`);
  });

  it('число каждого фильтра равно строкам после нажатия, в верху и ниже него', () => {
    const closed = [...Array.from({ length: 60 }, (_, n) => n + 1), 230, 250, 290];
    const { facets, filtered } = build(closed);
    expect(facets.total).toBe(filtered.length);
    expect(facets.regions.length).toBeGreaterThan(1);
    for (const { id: region, count } of facets.regions) {
      expect(build(closed, { region: [region] }).filtered, region).toHaveLength(count);
    }
    for (const { level, count } of facets.levels) {
      expect(build(closed, { level: [level] }).filtered, level).toHaveLength(count);
    }
    expect(build(closed, { remote: '1' }).filtered).toHaveLength(facets.remote);
    for (const { role, count } of facets.roles) {
      expect(build(closed, { role: [role] }).filtered, role).toHaveLength(count);
    }
  });
});
