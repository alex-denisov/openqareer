import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';

/**
 * B161 review §1 and §3, carried into B164:
 *  - a vacancy the source stopped publishing was never evicted, so a posting
 *    taken down an hour after one sync kept being offered for thirty days;
 *  - `syncSource` returned void, so the admin console printed «успех» over a
 *    completely failed run and over an id that does not exist.
 */
const SOURCE: VacancySourceConfig = {
  id: 'src-test',
  name: 'Тестовый источник',
  type: 'rss',
  enabled: true,
  targetUrl: 'https://example.test/feed',
  refreshIntervalMinutes: 60,
  itemsFoundTotal: 0,
  itemsActiveTotal: 0,
};

function vacancy(id: string, publishedAt = new Date().toISOString()): UnifiedVacancy {
  return {
    id,
    fingerprint: id,
    title: `Инженер ${id}`,
    company: 'Тестовая компания',
    description: 'Описание',
    requiredSkills: [],
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'rss',
      sourceId: 'src-test',
      sourceUrl: `https://example.test/${id}`,
      observedAt: new Date().toISOString(),
    },
    publishedAt,
    status: 'active',
  };
}

describe('sync outcome and eviction', () => {
  it('drops a vacancy the source no longer publishes', async () => {
    let batch = [vacancy('a'), vacancy('b')];
    const engine = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      fetcher: async () => batch,
    });

    await engine.syncSource('src-test');
    expect(
      engine
        .getVacancies()
        .items.map((item) => item.id)
        .sort(),
    ).toEqual(['a', 'b']);

    batch = [vacancy('b')];
    await engine.syncSource('src-test');

    expect(engine.getVacancies().items.map((item) => item.id)).toEqual(['b']);
  });

  it('keeps another source untouched when one source shrinks', async () => {
    const other: VacancySourceConfig = { ...SOURCE, id: 'src-other', name: 'Другой' };
    const engine = new MultiSourceVacancyEngine({
      sources: [SOURCE, other],
      fetcher: async (source) =>
        source.id === 'src-test'
          ? [vacancy('a')]
          : [
              {
                ...vacancy('z'),
                provenance: { ...vacancy('z').provenance, sourceId: 'src-other' },
              },
            ],
    });

    await engine.syncAll();
    expect(engine.getVacancies().total).toBe(2);

    await engine.syncSource('src-test');
    expect(engine.getVacancies().total).toBe(2);
  });

  it('reports what a sync actually did instead of returning nothing', async () => {
    const engine = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      fetcher: async () => [vacancy('a'), vacancy('b')],
    });

    const outcome = await engine.syncSource('src-test');

    expect(outcome).toMatchObject({ sourceId: 'src-test', status: 'healthy', fetched: 2, kept: 2 });
  });

  it('reports a failed sync as failed, with the reason', async () => {
    const engine = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      fetcher: async () => {
        throw new Error('vacancy_source_unreachable: 500');
      },
    });

    const outcome = await engine.syncSource('src-test');

    expect(outcome.status).toBe('error');
    expect(outcome.message).toContain('500');
    expect(outcome.kept).toBe(0);
  });

  it('says plainly that an unknown source was not synced', async () => {
    const engine = new MultiSourceVacancyEngine({ sources: [SOURCE], fetcher: async () => [] });

    const outcome = await engine.syncSource('src-does-not-exist');

    expect(outcome.status).toBe('unknown_source');
  });

  it('does not contact a query-only source during a query-less sync', async () => {
    const contacted: string[] = [];
    const engine = new MultiSourceVacancyEngine({
      sources: [{ ...SOURCE, id: 'src-query-only', requiresQuery: true }],
      fetcher: async (source) => {
        contacted.push(source.id);
        return [];
      },
    });

    const outcome = await engine.syncSource('src-query-only');

    expect(contacted).toEqual([]);
    expect(outcome.status).toBe('skipped_needs_query');
  });

  it('summarises a full run per source rather than reporting one blanket success', async () => {
    const failing: VacancySourceConfig = { ...SOURCE, id: 'src-failing', name: 'Падающий' };
    const engine = new MultiSourceVacancyEngine({
      sources: [SOURCE, failing],
      fetcher: async (source) => {
        if (source.id === 'src-failing') throw new Error('vacancy_source_unreachable: 503');
        return [vacancy('a')];
      },
    });

    const outcomes = await engine.syncAll();

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['error', 'healthy']);
  });

  /**
   * B161 review §2 — nothing ever called `syncAll` except an admin button, so
   * in a fresh process the pool stayed empty until someone pressed it, and it
   * emptied again on every deploy.
   */
  it('syncs a source that has never been read', async () => {
    const engine = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      fetcher: async () => [vacancy('a')],
    });

    const outcomes = await engine.syncDue(Date.parse('2026-08-30T12:00:00.000Z'));

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['healthy']);
  });

  it('leaves a source alone until its own interval has elapsed', async () => {
    let calls = 0;
    const engine = new MultiSourceVacancyEngine({
      sources: [{ ...SOURCE, refreshIntervalMinutes: 60 }],
      fetcher: async () => {
        calls += 1;
        return [vacancy('a')];
      },
    });

    await engine.syncDue(Date.parse('2026-08-30T12:00:00.000Z'));
    await engine.syncDue(Date.parse('2026-08-30T12:30:00.000Z'));

    expect(calls).toBe(1);
  });

  it('syncs again once the interval has passed', async () => {
    let calls = 0;
    const engine = new MultiSourceVacancyEngine({
      sources: [{ ...SOURCE, refreshIntervalMinutes: 60 }],
      fetcher: async () => {
        calls += 1;
        return [vacancy('a')];
      },
    });

    await engine.syncDue(Date.parse('2026-08-30T12:00:00.000Z'));
    await engine.syncDue(Date.parse('2026-08-30T13:01:00.000Z'));

    expect(calls).toBe(2);
  });

  it('never runs two syncs of the same source at once', async () => {
    let inFlight = 0;
    let overlapped = false;
    const engine = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      fetcher: async () => {
        inFlight += 1;
        if (inFlight > 1) overlapped = true;
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return [vacancy('a')];
      },
    });

    await Promise.all([
      engine.syncDue(Date.parse('2026-08-30T12:00:00.000Z')),
      engine.syncDue(Date.parse('2026-08-30T12:00:00.000Z')),
    ]);

    expect(overlapped).toBe(false);
  });
});
