import { describe, expect, it } from 'vitest';
import { peekMatchedVacancies, readMatchedSnapshot } from './matchedPoolContext';
import type { RouteDeps } from '../routes/deps';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/**
 * `/today` (B230) only ever peeks a snapshot the cabinet already computed via
 * `readMatchedSnapshot`; the target level is part of the snapshot key, so a
 * peek with a different level must miss even for the same candidate.
 */
describe('peekMatchedVacancies (B230)', () => {
  const item = (id: string) => ({ cluster: { id } }) as unknown as MatchedVacancyItem;

  function fakeEngine(items: MatchedVacancyItem[]): RouteDeps['multiSourceEngine'] {
    return {
      getMatchedVacanciesAsync: async () => items,
    } as unknown as RouteDeps['multiSourceEngine'];
  }

  it('finds the snapshot written by readMatchedSnapshot for the same target level', async () => {
    const engine = fakeEngine([item('a')]);
    const written = await readMatchedSnapshot(engine, 'candidate-1', ['skill'], ['Product Manager'], 'lead');

    const peeked = peekMatchedVacancies(engine, 'candidate-1', ['skill'], ['Product Manager'], 'lead');

    expect(peeked).toBe(written);
  });

  it('misses when the target level differs from the written snapshot', async () => {
    const engine = fakeEngine([item('a')]);
    await readMatchedSnapshot(engine, 'candidate-1', ['skill'], ['Product Manager'], 'lead');

    const peeked = peekMatchedVacancies(engine, 'candidate-1', ['skill'], ['Product Manager'], 'head');

    expect(peeked).toBeUndefined();
  });
});
