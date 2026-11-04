import { describe, expect, it } from 'vitest';
import {
  invalidateMatchedVacancies,
  markMatchedVacanciesStale,
  peekMatchedVacancies,
  readMatchedSnapshot,
  setMatchedRecentTitlesReader,
} from './matchedPoolContext';
import type { MatchGeography } from './matchGeography';
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

describe('диапазон грейда в подборе (этап 1, 04.11)', () => {
  function recordingEngine() {
    const calls: { gradeRange?: unknown }[] = [];
    const engine = {
      getMatchedVacanciesAsync: async (input: { gradeRange?: unknown }) => {
        calls.push(input);
        return [{ vacancy: { id: 'a' } }];
      },
    } as unknown as RouteDeps['multiSourceEngine'];
    return { engine, calls };
  }

  it('слово в роли сужает подбор любого кандидата', async () => {
    const { engine, calls } = recordingEngine();
    await readMatchedSnapshot(engine, 'candidate-1', ['skill'], ['Senior Frontend Developer'], 'ic');
    expect(calls[0].gradeRange).toEqual({ min: 3, max: 5 });
  });

  it('без слова в ролях берёт последние места', async () => {
    const { engine, calls } = recordingEngine();
    setMatchedRecentTitlesReader(engine, () => ['Senior Developer', 'Developer', 'Junior Developer']);
    await readMatchedSnapshot(engine, 'candidate-1', ['skill'], ['Frontend Developer'], 'ic');
    expect(calls[0].gradeRange).toEqual({ min: 3, max: 5 });
  });

  it('без слова нигде подбор не сужается', async () => {
    const { engine, calls } = recordingEngine();
    await readMatchedSnapshot(engine, 'candidate-1', ['skill'], ['Frontend Developer'], 'ic');
    expect(calls[0].gradeRange).toBeUndefined();
  });

  it('«Сегодня» находит снимок кандидата с диапазоном', async () => {
    const { engine } = recordingEngine();
    const written = await readMatchedSnapshot(engine, 'candidate-1', ['skill'], ['Senior Developer'], 'ic');
    expect(peekMatchedVacancies(engine, 'candidate-1', ['skill'], ['Senior Developer'], 'ic')).toBe(written);
  });
});

/** PRB-041: a text landing in the shared pool never hides what the candidate just changed. */
describe('a shared text write and the candidate own changes', () => {
  const item = (id: string) => ({ cluster: { id } }) as unknown as MatchedVacancyItem;
  const BERLIN: MatchGeography = { cityNames: ['Berlin'], remote: true, remoteAreas: [] };

  function countingEngine() {
    let reads = 0;
    return {
      getMatchedVacanciesAsync: async () => [item(`read-${(reads += 1)}`)],
    } as unknown as RouteDeps['multiSourceEngine'];
  }
  const read = (
    engine: RouteDeps['multiSourceEngine'],
    change: {
      skills?: string[];
      roles?: string[];
      level?: 'lead' | 'head';
      geography?: MatchGeography;
    } = {},
  ) =>
    readMatchedSnapshot(
      engine,
      'candidate-1',
      change.skills ?? ['skill'],
      change.roles ?? ['Role'],
      change.level ?? 'lead',
      change.geography,
    );

  it('the same inputs keep the served snapshot after a text write', async () => {
    const engine = countingEngine();
    const before = await read(engine);
    markMatchedVacanciesStale(engine);
    expect(await read(engine)).toBe(before);
  });

  it.each([
    ['a profile skill', { skills: ['skill', 'new'] }],
    ['a role', { roles: ['Other role'] }],
    ['a level', { level: 'head' as const }],
    ['a region', { geography: BERLIN }],
  ])('a changed %s reads fresh right after a text write', async (_name, change) => {
    const engine = countingEngine();
    const before = await read(engine);
    markMatchedVacanciesStale(engine);
    const after = await read(engine, change);
    expect(after).not.toBe(before);
    expect(after[0]?.cluster.id).toBe('read-2');
  });

  it('a saved campaign with the same inputs reads fresh right after a text write', async () => {
    const engine = countingEngine();
    await read(engine);
    markMatchedVacanciesStale(engine);
    invalidateMatchedVacancies(engine, 'candidate-1');
    expect((await read(engine))[0]?.cluster.id).toBe('read-2');
  });
});
