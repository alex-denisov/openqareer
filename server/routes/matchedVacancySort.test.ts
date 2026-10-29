import { describe, expect, it, vi } from 'vitest';
import { resolveVacancySort } from './matchedVacancySort';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';

function store(initial: Partial<CandidateWorkspaceState> | null) {
  let workspace = initial as CandidateWorkspaceState | null;
  const save = vi.fn((_: string, next: CandidateWorkspaceState) => {
    workspace = next;
    return next;
  });
  return {
    deps: {
      candidateStore: { getCandidateWorkspace: () => workspace, saveCandidateWorkspace: save },
    } as never,
    save,
  };
}

describe('per-account vacancy sort (owner 29.10)', () => {
  it('defaults to «Совпадение» descending', () => {
    expect(resolveVacancySort(store({ regions: [] }).deps, 'c', {})).toEqual({
      by: 'fit',
      dir: 'desc',
    });
  });
  it('saves a named sort and reads it back without one', () => {
    const { deps, save } = store({ regions: [] });
    expect(resolveVacancySort(deps, 'c', { sort: 'money', dir: 'asc' })).toEqual({
      by: 'money',
      dir: 'asc',
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(resolveVacancySort(deps, 'c', {})).toEqual({ by: 'money', dir: 'asc' });
    resolveVacancySort(deps, 'c', { sort: 'money', dir: 'asc' });
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('does not create a workspace for a candidate without one', () => {
    const { deps, save } = store(null);
    expect(resolveVacancySort(deps, 'c', { sort: 'money' })).toEqual({ by: 'money', dir: 'desc' });
    expect(save).not.toHaveBeenCalled();
  });
});
