import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';

const BOARD: VacancySourceConfig = {
  id: 'board',
  name: 'Board',
  type: 'json_api',
  enabled: true,
  targetUrl: 'https://example.test/jobs',
  refreshIntervalMinutes: 60,
  itemsFoundTotal: 0,
  itemsActiveTotal: 0,
};

const CHANNEL: VacancySourceConfig = {
  ...BOARD,
  id: 'channel',
  name: 'Channel',
  type: 'telegram',
  targetUrl: 'https://t.me/s/jobs',
};

function vacancy(
  id: string,
  overrides: Partial<UnifiedVacancy> & { sourceId: string },
): UnifiedVacancy {
  const now = new Date().toISOString();
  const { sourceId, ...rest } = overrides;
  return {
    id,
    fingerprint: `fp-${id}`,
    title: `Role ${id}`,
    company: `Company ${id}`,
    isRemote: true,
    description: 'Description',
    requiredSkills: [],
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: sourceId === CHANNEL.id ? 'telegram' : 'json_api',
      sourceId,
      sourceUrl: `https://example.test/${id}`,
      observedAt: now,
    },
    publishedAt: now,
    status: 'active',
    ...rest,
  };
}

async function filledEngine(): Promise<MultiSourceVacancyEngine> {
  const engine = new MultiSourceVacancyEngine({
    sources: [BOARD, CHANNEL],
    fetcher: async (source) =>
      source.id === BOARD.id
        ? [
            vacancy('b1', {
              sourceId: BOARD.id,
              title: 'Senior React Developer',
              company: 'Aurora',
            }),
            vacancy('b2', {
              sourceId: BOARD.id,
              title: 'Data Engineer',
              company: 'Borealis',
              isRemote: false,
              description: 'On site in Berlin',
              requiredSkills: ['Python'],
            }),
          ]
        : [
            vacancy('c1', {
              sourceId: CHANNEL.id,
              title: 'Product Manager',
              company: 'Cirrus',
            }),
          ],
  });
  await engine.syncAll();
  return engine;
}

describe('MultiSourceVacancyEngine query surface', () => {
  it('counts every source in the statistics, including the ones the filter excludes', async () => {
    const engine = await filledEngine();
    const result = engine.getVacancies({ sourceId: BOARD.id });
    expect(result.total).toBe(2);
    expect(result.statsBySource).toEqual([
      { sourceId: BOARD.id, sourceName: 'Board', count: 2 },
      { sourceId: CHANNEL.id, sourceName: 'Channel', count: 1 },
    ]);
  });

  it('narrows by source type, remoteness and free text', async () => {
    const engine = await filledEngine();
    expect(engine.getVacancies({ type: 'telegram' }).items.map((v) => v.id)).toEqual(['c1']);
    expect(engine.getVacancies({ isRemote: false }).items.map((v) => v.id)).toEqual(['b2']);
    expect(engine.getVacancies({ query: 'aurora' }).items.map((v) => v.id)).toEqual(['b1']);
    expect(engine.getVacancies({ query: 'berlin' }).items.map((v) => v.id)).toEqual(['b2']);
    expect(engine.getVacancies({ query: 'python' }).items.map((v) => v.id)).toEqual(['b2']);
    expect(engine.getVacancies({ query: 'nothing-here' }).total).toBe(0);
  });

  it('pages without losing the total', async () => {
    const engine = await filledEngine();
    const page = engine.getVacancies({ limit: 1, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
  });

  it('adds, disables and removes a source through the registry', async () => {
    const engine = new MultiSourceVacancyEngine({ sources: [BOARD], fetcher: async () => [] });
    engine.addOrUpdateSource({ ...CHANNEL });
    expect(engine.getSources().map((s) => s.id)).toEqual([BOARD.id, CHANNEL.id]);

    expect(engine.toggleSource(CHANNEL.id, false).enabled).toBe(false);
    await expect(engine.syncSource(CHANNEL.id)).resolves.toMatchObject({
      status: 'disabled',
    });

    expect(engine.removeSource(CHANNEL.id)).toBe(true);
    expect(engine.removeSource(CHANNEL.id)).toBe(false);
    expect(() => engine.toggleSource(CHANNEL.id, true)).toThrow(/не найден/);
  });

  it('reports a live test run with what the source actually returned', async () => {
    const engine = new MultiSourceVacancyEngine({
      sources: [BOARD],
      fetcher: async () => [vacancy('b1', { sourceId: BOARD.id })],
    });
    const probe = await engine.testSource(BOARD.id, 'react');
    expect(probe).toMatchObject({ success: true, count: 1, sourceName: 'Board' });
    expect(probe.vacancies.map((v) => v.id)).toEqual(['b1']);

    await expect(engine.testSource('missing')).rejects.toThrow(/не найден/);
  });

  it('reports a failing test run with the reason instead of an empty success', async () => {
    const engine = new MultiSourceVacancyEngine({
      sources: [BOARD],
      fetcher: async () => {
        throw new Error('source_unreachable');
      },
    });
    const probe = await engine.testSource(BOARD.id);
    expect(probe).toMatchObject({
      success: false,
      count: 0,
      message: 'source_unreachable',
    });
  });
});
