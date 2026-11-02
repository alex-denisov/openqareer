import type { RouteDeps } from './deps';

type CandidateStore = RouteDeps['candidateStore'];
const SCOPED_READS = new Set<PropertyKey>(['getSnapshot', 'getCandidateWorkspace']);

/**
 * One request reads the candidate's snapshot and workspace once (prod CPU profile 03.11: one
 * list page opened them 4–5 times, ~3 of 21 busy seconds). The store's own memo drops on any
 * commit, and the fit queue writes during the same page. Inside one request a read the request
 * made earlier is current enough; background work started by it must use the unscoped deps.
 */
export function withRequestScopedCandidateReads(deps: RouteDeps): RouteDeps {
  const store = deps.candidateStore;
  const kept = new Map<string, unknown>();
  const scoped = new Proxy(store, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      if (!SCOPED_READS.has(property)) return value.bind(target);
      return (candidateId: string, ...rest: unknown[]) => {
        // A staged read (consultant turn) is a different snapshot: never kept.
        if (rest.some((argument) => argument !== undefined)) return value.call(target, candidateId, ...rest);
        const key = `${String(property)}\u0000${candidateId}`;
        if (!kept.has(key)) kept.set(key, value.call(target, candidateId));
        return kept.get(key);
      };
    },
  }) as CandidateStore;
  return { ...deps, candidateStore: scoped };
}
