import { describe, expect, it } from 'vitest';
import {
  savedVacancyStates,
  type SavedVacancyMatchContext,
  type SavedVacancyStateSource,
} from './savedVacancyStates';

const head = {
  status: 'active' as const,
  canonicalTitle: 'Head of Engineering',
  canonicalLocation: 'Москва',
  isRemote: false,
  salary: { from: 450_000, to: 600_000, currency: 'RUR' },
};

type Cluster = NonNullable<ReturnType<SavedVacancyStateSource['getActiveCluster']>>;

function source(): SavedVacancyStateSource {
  const active = new Map<string, Cluster>([
    ['open-1', head],
    ['dead-1', { ...head, linkStatus: 'gone' as const, salary: undefined }],
  ]);
  const byUrl = new Map<string, Cluster>([
    [
      'https://example.test/berlin',
      { ...head, canonicalTitle: 'Director of Engineering', canonicalLocation: 'Berlin, Germany' },
    ],
  ]);
  return {
    getActiveCluster: (id) => active.get(id),
    getActiveClusterByMemberKey: (key) => byUrl.get(key),
    isKnownVacancyGone: (id) => id === 'cluster-gone-1',
    getVacancy: (id) => (id === 'gone-1' ? { archivedAt: '2026-10-06T09:00:00.000Z' } : undefined),
  };
}

const context: SavedVacancyMatchContext = {
  candidateLevel: 'head',
  regions: ['ru'],
  getTitleParse: () => undefined,
};

describe('savedVacancyStates', () => {
  it('matches level and geography of a saved vacancy found by id, as the selection does', () => {
    const states = savedVacancyStates(source(), [{ clusterId: 'open-1' }], context);
    expect(states['open-1']).toEqual({
      closed: false,
      inCatalog: true,
      salary: { from: 450_000, to: 600_000, currency: 'RUR' },
      vacancyLevel: 'head',
      levelMatch: 'match',
      location: 'Москва',
      isRemote: false,
      outsideGeography: false,
    });
  });

  it('falls back to the vacancy URL when the id left the catalog', () => {
    const states = savedVacancyStates(
      source(),
      [{ clusterId: 'rebuilt-1', url: 'https://example.test/berlin/' }],
      context,
    );
    expect(states['rebuilt-1']).toMatchObject({
      inCatalog: true,
      location: 'Berlin, Germany',
      outsideGeography: true,
    });
  });

  it('marks a dead link closed and a removed vacancy closed with its date, both out of the catalog', () => {
    const states = savedVacancyStates(
      source(),
      [{ clusterId: 'dead-1' }, { clusterId: 'cluster-gone-1' }],
      context,
    );
    expect(states['dead-1']).toMatchObject({ closed: true, inCatalog: true });
    expect(states['cluster-gone-1']).toEqual({
      closed: true,
      inCatalog: false,
      closedAt: '2026-10-06T09:00:00.000Z',
    });
  });

  it('reports an unknown vacancy as out of the catalog instead of guessing', () => {
    expect(savedVacancyStates(source(), [{ clusterId: 'nobody' }], context)).toEqual({
      nobody: { closed: false, inCatalog: false },
    });
  });
});
