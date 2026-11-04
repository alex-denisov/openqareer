import { describe, expect, it, vi } from 'vitest';
import { MatchedPoolPrecompute } from './matchedPoolPrecompute';
import { peekMatchedVacancies, readMatchedSnapshot } from './matchedPoolContext';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import type { RouteDeps } from '../routes/deps';
import { buildApp } from '../app';
import { config, noSessions } from '../appTestHarness';

describe('MatchedPoolPrecompute (C60)', () => {
  const item = (id: string) => ({ cluster: { id } }) as unknown as MatchedVacancyItem;

  const oneCandidate = () =>
    ({
      listRecentCampaignCandidateIds: () => ['candidate-1'],
      getSnapshot: () => ({
        memory: [
          { kind: 'fact', domain: 'skill', confidence: 'candidate-confirmed', statement: 'SQL' },
        ],
      }),
      getCandidateWorkspace: () => ({
        resumeText: '',
        resumeSource: 'text',
        targetDirection: '',
        regions: [],
        currentSituation: '',
        constraints: '',
        urgency: 'active',
        campaign: {
          roles: ['Head of Engineering'],
          regions: [],
          revision: 1,
          updatedAt: '2026-09-27T00:00:00.000Z',
        },
      }),
    }) as unknown as RouteDeps['candidateStore'];

  it('PRB-041: the round waits for an expired snapshot, one candidate after another', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let reads = 0;
      const engine = {
        getMatchedVacanciesAsync: async () => [item(`read-${(reads += 1)}`)],
      } as unknown as RouteDeps['multiSourceEngine'];
      const fits: string[] = [];
      const precompute = new MatchedPoolPrecompute({
        candidateStore: oneCandidate(),
        engine,
        pauseMs: 0,
      });
      precompute.setFitRequester(async (_candidate, snapshot) => {
        fits.push(snapshot[0]!.cluster.id);
      });

      await precompute.run();
      vi.advanceTimersByTime(11 * 60_000);
      await precompute.run();

      expect(fits).toEqual(['read-1', 'read-2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('PRB-041: a rebuild failing behind a read reaches the log without its message', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let fail = false;
      const engine = {
        getMatchedVacanciesAsync: async () => {
          if (fail) throw new Error('private pool detail');
          return [item('old')];
        },
      } as unknown as RouteDeps['multiSourceEngine'];
      const error = vi.fn();
      new MatchedPoolPrecompute({
        candidateStore: oneCandidate(),
        engine,
        log: { info: vi.fn(), error },
      });
      const read = () => readMatchedSnapshot(engine, 'candidate-1', ['SQL'], ['Lead'], undefined);
      const old = await read();
      fail = true;
      vi.advanceTimersByTime(11 * 60_000);

      expect(await read()).toBe(old);
      await new Promise((resolve) => setImmediate(resolve));

      expect(error).toHaveBeenCalledWith(
        { errorName: 'Error' },
        'matched-snapshot-rebuild-failed',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a fresh prepared snapshot and invalidates it before a changed campaign is queued', async () => {
    let reads = 0;
    const engine = {
      getMatchedVacanciesAsync: async () => {
        reads += 1;
        return [item('prepared')];
      },
    } as unknown as RouteDeps['multiSourceEngine'];
    const store = {
      listRecentCampaignCandidateIds: () => ['candidate-1'],
      getSnapshot: () => ({
        memory: [
          {
            kind: 'fact',
            domain: 'skill',
            confidence: 'candidate-confirmed',
            statement: 'TypeScript',
          },
        ],
      }),
      getCandidateWorkspace: () => ({
        resumeText: '',
        resumeSource: 'text',
        targetDirection: '',
        regions: [],
        currentSituation: '',
        constraints: '',
        urgency: 'active',
        campaign: {
          roles: ['Head of Engineering'],
          regions: [],
          revision: 1,
          updatedAt: '2026-09-27T00:00:00.000Z',
        },
      }),
    } as unknown as RouteDeps['candidateStore'];
    const precompute = new MatchedPoolPrecompute({ candidateStore: store, engine });

    await precompute.run();
    await readMatchedSnapshot(
      engine,
      'candidate-1',
      ['TypeScript'],
      ['Head of Engineering'],
      'head',
    );
    expect(reads).toBe(1);

    precompute.prioritizeCampaign('candidate-1');
    expect(
      peekMatchedVacancies(engine, 'candidate-1', ['TypeScript'], ['Head of Engineering'], 'head'),
    ).toBeUndefined();
  });

  it("rebuilds a candidate's auto roles once per process before the first prepared selection", async () => {
    const order: string[] = [];
    const engine = {
      getMatchedVacanciesAsync: async () => {
        order.push('snapshot');
        return [item('prepared')];
      },
    } as unknown as RouteDeps['multiSourceEngine'];
    const store = {
      listRecentCampaignCandidateIds: () => ['candidate-1'],
      getSnapshot: () => ({ memory: [] }),
      getCandidateWorkspace: () => ({
        resumeText: '',
        resumeSource: 'text',
        targetDirection: '',
        regions: [],
        currentSituation: '',
        constraints: '',
        urgency: 'active',
        campaign: {
          roles: ['Head of Engineering'],
          regions: [],
          revision: 1,
          updatedAt: '2026-09-27T00:00:00.000Z',
        },
      }),
    } as unknown as RouteDeps['candidateStore'];
    const precompute = new MatchedPoolPrecompute({ candidateStore: store, engine, pauseMs: 0 });
    precompute.setCampaignRoleRefresher(async (candidateId) => {
      order.push(`roles:${candidateId}`);
    });

    await precompute.run();
    precompute.prioritizeCampaign('candidate-1');
    await precompute.run();

    expect(order).toEqual(['roles:candidate-1', 'snapshot', 'snapshot']);
  });

  it('waits for the reader without blocking an unrelated health request', async () => {
    let release!: () => void;
    const engine = {
      getMatchedVacanciesAsync: () =>
        new Promise<MatchedVacancyItem[]>((resolve) => {
          release = () => resolve([item('slow')]);
        }),
    } as unknown as RouteDeps['multiSourceEngine'];
    const store = {
      listRecentCampaignCandidateIds: () => ['candidate-1'],
      getSnapshot: () => ({
        memory: [
          {
            kind: 'fact',
            domain: 'skill',
            confidence: 'candidate-confirmed',
            statement: 'TypeScript',
          },
        ],
      }),
      getCandidateWorkspace: () => ({
        resumeText: '',
        resumeSource: 'text',
        targetDirection: '',
        regions: [],
        currentSituation: '',
        constraints: '',
        urgency: 'active',
        campaign: {
          roles: ['Head of Engineering'],
          regions: [],
          revision: 1,
          updatedAt: '2026-09-27T00:00:00.000Z',
        },
      }),
    } as unknown as RouteDeps['candidateStore'];
    const precompute = new MatchedPoolPrecompute({ candidateStore: store, engine, pauseMs: 0 });
    const app = await buildApp({
      config,
      candidateStore: store,
      authService: noSessions,
      coachProvider: {
        async createTurn() {
          throw new Error('not_used');
        },
      },
      multiSourceVacancyEngine: engine,
      serveStatic: false,
    });
    try {
      await app.inject('/health');
      const work = precompute.run();
      await Promise.resolve();
      const startedAt = performance.now();
      const health = await app.inject('/health');
      const healthElapsedMs = performance.now() - startedAt;
      release();
      await work;

      expect(health.statusCode).toBe(200);
      expect(healthElapsedMs).toBeLessThan(100);
    } finally {
      await app.close();
    }
  });

  it('hands each prepared selection to the fit queue, so fits run without a list read (02.11)', async () => {
    const engine = {
      getMatchedVacanciesAsync: async () => [item('a'), item('b')],
    } as unknown as RouteDeps['multiSourceEngine'];
    const store = {
      listRecentCampaignCandidateIds: () => ['candidate-1'],
      getSnapshot: () => ({
        memory: [
          {
            kind: 'fact',
            domain: 'skill',
            confidence: 'candidate-confirmed',
            statement: 'TypeScript',
          },
        ],
      }),
      getCandidateWorkspace: () => ({
        resumeText: '',
        resumeSource: 'text',
        targetDirection: '',
        regions: [],
        currentSituation: '',
        constraints: '',
        urgency: 'active',
        campaign: {
          roles: ['Head of Engineering'],
          regions: [],
          revision: 1,
          updatedAt: '2026-11-02T00:00:00.000Z',
        },
      }),
    } as unknown as RouteDeps['candidateStore'];
    const precompute = new MatchedPoolPrecompute({ candidateStore: store, engine, pauseMs: 0 });
    const handed: { candidateId: string; ids: string[] }[] = [];
    precompute.setFitRequester(async (candidateId, snapshot) => {
      handed.push({ candidateId, ids: snapshot.map((row) => row.cluster.id) });
    });

    await precompute.run();

    expect(handed).toEqual([{ candidateId: 'candidate-1', ids: ['a', 'b'] }]);
  });
});
