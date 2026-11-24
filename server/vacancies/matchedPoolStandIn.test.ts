import { describe, expect, it, vi } from 'vitest';
import { MatchedPoolPrecompute } from './matchedPoolPrecompute';
import { MatchedPoolSnapshots } from './matchedPoolSnapshot';
import { readMatchedSnapshot } from './matchedPoolContext';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

const item = (id: string) => ({ cluster: { id } }) as unknown as MatchedVacancyItem;
const never = () => new Promise<MatchedVacancyItem[]>(() => undefined);
const build = (id: string) => async () => [item(id)];

describe('the last list of the same roles stands in for a 503 (B702)', () => {
  const snapshots = () => new MatchedPoolSnapshots({ waitMs: 20, staleWaitMs: 10 });

  async function warmed() {
    const pool = snapshots();
    await pool.readAsync('one', 'facts-1', build('old'), { scope: 'cto' });
    await pool.readAsync('one', 'facts-1', never, { scope: 'cto' });
    return pool;
  }

  it('an edited fact whose build is slow reads the last list, the build goes on', async () => {
    const pool = await warmed();
    let finish!: (items: MatchedVacancyItem[]) => void;
    const slow = vi.fn(
      () =>
        new Promise<MatchedVacancyItem[]>((resolve) => {
          finish = resolve;
        }),
    );
    const read = () => pool.readAsync('one', 'facts-2', slow, { scope: 'cto' });
    expect((await read())[0]?.cluster.id).toBe('old');
    finish([item('new')]);
    await vi.waitFor(async () => expect((await read())[0]?.cluster.id).toBe('new'));
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it('a quick build answers with the new list at once', async () => {
    const pool = await warmed();
    const read = await pool.readAsync('one', 'facts-2', build('new'), { scope: 'cto' });
    expect(read[0]?.cluster.id).toBe('new');
  });

  it('a busy reader is not a refusal when a list is held', async () => {
    const pool = await warmed();
    const busy = async () => {
      throw new Error('busy');
    };
    expect((await pool.readAsync('one', 'facts-2', busy, { scope: 'cto' }))[0]?.cluster.id).toBe(
      'old',
    );
  });

  it.each([
    ['another candidate', 'two', 'cto'],
    ['another role', 'one', 'coo'],
  ])('%s never reads it', async (_name, candidate, scope) => {
    const pool = await warmed();
    await expect(pool.readAsync(candidate, 'facts-2', never, { scope })).rejects.toThrow();
  });

  it('a saved campaign drops it', async () => {
    const pool = await warmed();
    pool.deleteCandidate('one');
    await expect(pool.readAsync('one', 'facts-2', never, { scope: 'cto' })).rejects.toThrow();
  });

  it('a background pass waits for the new list', async () => {
    const pool = await warmed();
    const read = await pool.readAsync('one', 'facts-2', build('new'), {
      scope: 'cto',
      awaitRebuild: true,
    });
    expect(read[0]?.cluster.id).toBe('new');
  });
});

describe('roles rebuilt by the machine keep the snapshots (B702, prod 24.11 16:23Z)', () => {
  it('the same roles and facts read the list they had', async () => {
    const getMatchedVacanciesAsync = vi.fn(async () => [item('kept')]);
    const engine = { getMatchedVacanciesAsync } as never;
    const precompute = new MatchedPoolPrecompute({
      candidateStore: { getSnapshot: () => null } as never,
      engine,
    });
    const read = () => readMatchedSnapshot(engine, 'one', ['fact'], ['CTO'], undefined);
    const before = await read();
    precompute.refreshCampaign('one');
    expect(await read()).toBe(before);
    precompute.prioritizeCampaign('one');
    expect(await read()).not.toBe(before);
  });
});
