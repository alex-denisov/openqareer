import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';

/**
 * A vacancy the candidate never observed must never be presented as observed.
 *
 * The engine used to seed hand-written fixtures at construction and to
 * substitute them whenever a real source returned nothing — so a failing
 * source reported itself `healthy` with fabricated content, and every cluster
 * carried the same `observedAt` millisecond (B161).
 */
describe('vacancy evidence honesty', () => {
  it('reports no vacancies before any source has been fetched', () => {
    const engine = new MultiSourceVacancyEngine();

    expect(engine.getVacancies().total).toBe(0);
    expect(engine.getActiveClusters()).toHaveLength(0);
  });

  it('does not claim a source is healthy before it has ever been contacted', () => {
    const engine = new MultiSourceVacancyEngine();

    const claimedHealthy = engine
      .getSources()
      .filter((source) => source.lastStatus === 'healthy');

    expect(claimedHealthy).toEqual([]);
  });

  it('never carries a synthesised last-sync time before a real sync', () => {
    const engine = new MultiSourceVacancyEngine();

    expect(engine.getSources().filter((source) => source.lastSyncAt)).toEqual([]);
  });

  it('records an error, not a healthy empty result, when no transport exists', async () => {
    const engine = new MultiSourceVacancyEngine();

    await engine.syncSource('src-tg-itjobs');

    const source = engine.getSource('src-tg-itjobs');
    expect(source?.lastStatus).toBe('error');
    expect(source?.lastErrorMessage).toBe('vacancy_source_transport_unavailable');
  });

  it('refuses to report a passing test run when no transport exists', async () => {
    const engine = new MultiSourceVacancyEngine();

    const result = await engine.testSource('src-tg-itjobs', 'product manager');

    expect(result.success).toBe(false);
  });

  it('leaves a source empty when its real fetch returns nothing', async () => {
    const engine = new MultiSourceVacancyEngine({
      fetcher: async () => [],
    });

    await engine.syncSource('src-tg-itjobs');

    expect(engine.getVacancies().total).toBe(0);
    expect(engine.getSource('src-tg-itjobs')?.itemsFoundTotal).toBe(0);
  });

  it('reports an empty test run as empty instead of substituting fixtures', async () => {
    const engine = new MultiSourceVacancyEngine({
      fetcher: async () => [],
    });

    const result = await engine.testSource('src-tg-itjobs', 'product manager');

    expect(result.count).toBe(0);
    expect(result.vacancies).toEqual([]);
  });
});
