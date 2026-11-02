import { describe, expect, it, vi } from 'vitest';
import { withRequestScopedCandidateReads } from './requestScopedCandidateReads';
import type { RouteDeps } from './deps';

function depsWith(store: object): RouteDeps {
  return { candidateStore: store } as unknown as RouteDeps;
}

describe('withRequestScopedCandidateReads', () => {
  it('reads the snapshot and the workspace once per candidate within a request', () => {
    const getSnapshot = vi.fn((id: string) => ({ id }));
    const getCandidateWorkspace = vi.fn((id: string) => ({ workspace: id }));
    const deps = withRequestScopedCandidateReads(depsWith({ getSnapshot, getCandidateWorkspace }));
    expect(deps.candidateStore.getSnapshot('a')).toBe(deps.candidateStore.getSnapshot('a'));
    deps.candidateStore.getSnapshot('b');
    deps.candidateStore.getCandidateWorkspace('a');
    deps.candidateStore.getCandidateWorkspace('a');
    expect(getSnapshot.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
    expect(getCandidateWorkspace).toHaveBeenCalledTimes(1);
  });
  it('never keeps a staged read and passes other methods through bound to the store', () => {
    class Store {
      calls = 0;
      getSnapshot(id: string, stage?: string) { this.calls += 1; return { id, stage }; }
      listVacancyDecisions() { return this.calls; }
    }
    const store = new Store();
    const deps = withRequestScopedCandidateReads(depsWith(store));
    deps.candidateStore.getSnapshot('a', 'intake' as never);
    deps.candidateStore.getSnapshot('a', 'intake' as never);
    expect(store.calls).toBe(2);
    const { listVacancyDecisions } = deps.candidateStore;
    expect(listVacancyDecisions('a')).toBe(2);
  });
  it('starts empty for the next request', () => {
    const getSnapshot = vi.fn((id: string) => ({ id }));
    const base = depsWith({ getSnapshot });
    withRequestScopedCandidateReads(base).candidateStore.getSnapshot('a');
    withRequestScopedCandidateReads(base).candidateStore.getSnapshot('a');
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });
});
