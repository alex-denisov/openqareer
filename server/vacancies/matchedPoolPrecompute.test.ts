import { describe, expect, it } from 'vitest';
import { MatchedPoolPrecompute } from './matchedPoolPrecompute';
import { peekMatchedVacancies, readMatchedSnapshot } from './matchedPoolContext';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import type { RouteDeps } from '../routes/deps';
import { buildApp } from '../app';
import { config, noSessions } from '../appTestHarness';

describe('MatchedPoolPrecompute (C60)', () => {
  const item = (id: string) => ({ cluster: { id } }) as unknown as MatchedVacancyItem;

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
});
