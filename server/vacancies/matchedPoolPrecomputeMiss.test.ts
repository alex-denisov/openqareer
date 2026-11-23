import { describe, expect, it, vi } from 'vitest';
import { MatchedPoolPrecompute } from './matchedPoolPrecompute';
import { readMatchedSnapshot } from './matchedPoolContext';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import type { RouteDeps } from '../routes/deps';

const candidateStore = {
  listRecentCampaignCandidateIds: () => ['first', 'second'],
  getSnapshot: () => ({ memory: [] }),
  getCandidateWorkspace: () => ({
    resumeText: '',
    resumeSource: 'text',
    targetDirection: '',
    regions: [],
    currentSituation: '',
    constraints: '',
    urgency: 'active',
    campaign: { roles: ['CTO'], regions: [], revision: 1, updatedAt: '2026-11-23T00:00:00.000Z' },
  }),
} as unknown as RouteDeps['candidateStore'];

describe('matched-snapshot-miss: is the pass on the candidate (B770, prod 23.11 04:47Z)', () => {
  it('a reader during the pass logs «on» for the candidate being built and «ahead» for the next', async () => {
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    const engine = {
      getMatchedVacanciesAsync: async () => {
        await held;
        return [{ cluster: { id: 'a' } } as unknown as MatchedVacancyItem];
      },
    } as unknown as RouteDeps['multiSourceEngine'];
    const info = vi.fn();
    const precompute = new MatchedPoolPrecompute({
      candidateStore,
      engine,
      log: { info, error: vi.fn() },
      pauseMs: 0,
    });
    const pass = precompute.run();
    await vi.waitFor(() => expect(precompute.stateOf('first')).toBe('on'));
    expect(precompute.stateOf('second')).toBe('ahead');

    const reading = readMatchedSnapshot(engine, 'second', [], ['VP'], undefined).catch(
      () => undefined,
    );
    const miss = info.mock.calls.find(([, message]) => message === 'matched-snapshot-miss');
    expect(miss?.[0]).toMatchObject({
      candidateId: 'second',
      precompute: 'ahead',
      keyInStore: false,
    });

    release();
    await pass;
    await reading;
    expect(precompute.stateOf('first')).toBe('idle');
    expect(precompute.stateOf('second')).toBe('idle');
  });
});
