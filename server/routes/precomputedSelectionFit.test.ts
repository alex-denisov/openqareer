import { describe, expect, it, vi } from 'vitest';
import type { RouteDeps } from './deps';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';

const requested = vi.hoisted(() => [] as { ids: readonly string[]; rank?: number }[]);
vi.mock('./matchedVacancyFit', () => ({
  requestFitForVacancyIds: (_deps: unknown, _id: string, ids: readonly string[], rank?: number) => {
    requested.push({ ids, rank });
  },
}));
vi.mock('./matchedVacancyRoutes', () => ({
  finishMatchedVacancies: (snapshot: readonly MatchedVacancyItem[]) => [...snapshot],
}));
vi.mock('./campaignContext', () => ({ readCampaign: () => ({ roles: { value: ['CIO'] } }) }));
vi.mock('../domain/vacancyFitProfileStamp', () => ({ vacancyFitProfileStamp: () => 'profile-1' }));

const { queuePrecomputedSelectionFit } = await import('./precomputedSelectionFit');

const item = (id: string) => ({ cluster: { id } }) as unknown as MatchedVacancyItem;
const deps = (plan: 'free' | 'pro') =>
  ({
    config: { billingEnforcement: true },
    billingRepository: { getEffectivePlanForCandidate: () => plan },
    candidateStore: { getSnapshot: () => ({}), getCandidateWorkspace: () => ({}) },
  }) as unknown as RouteDeps;

describe('the background precompute queues fits without a list read (02.11, prod 4c43fb31)', () => {
  it('queues the whole campaign selection in relevance order, ranked below the shown page', async () => {
    requested.length = 0;
    const snapshot = Array.from({ length: 45 }, (_, index) => item(`v${index}`));
    await queuePrecomputedSelectionFit(deps('pro'), 'candidate-pro', snapshot);
    expect(requested.map(({ rank }) => rank)).toEqual([0, 20, 40]);
    expect(requested.flatMap(({ ids }) => ids)).toEqual(snapshot.map((row) => row.cluster.id));
  });

  it('keeps the Free limit of 300 rows and does not repeat the same selection inside its window', async () => {
    requested.length = 0;
    const snapshot = Array.from({ length: 400 }, (_, index) => item(`f${index}`));
    await queuePrecomputedSelectionFit(deps('free'), 'candidate-free', snapshot);
    expect(requested.flatMap(({ ids }) => ids)).toHaveLength(300);
    await queuePrecomputedSelectionFit(deps('free'), 'candidate-free', snapshot);
    expect(requested.flatMap(({ ids }) => ids)).toHaveLength(300);
  });
});
