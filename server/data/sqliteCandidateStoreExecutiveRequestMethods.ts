import type { DatabaseSync } from 'node:sqlite';
import type { CandidateStore } from './candidateStore';
import {
  insertExecutiveRequest,
  selectExecutiveRequest,
  selectExecutiveRequests,
  selectExecutiveRequestQueue,
  updateExecutiveRequestStatus,
} from './store/executiveRequestStore';
import type { SealedText } from './sealedText';

type ExecutiveRequestMethods = Required<
  Pick<
    CandidateStore,
    | 'createExecutiveRequest'
    | 'listExecutiveRequests'
    | 'getExecutiveRequest'
    | 'listExecutiveRequestQueue'
    | 'setExecutiveRequestStatus'
  >
>;

interface ExecutiveRequestMethodDependencies {
  readonly database: DatabaseSync;
  readonly sealedText: SealedText;
  readonly requireCandidate: (candidateId: string) => void;
  readonly transaction: <T>(operation: () => T) => T;
}

export function createSqliteCandidateStoreExecutiveRequestMethods(
  dependencies: ExecutiveRequestMethodDependencies,
): ExecutiveRequestMethods {
  return {
    createExecutiveRequest: (candidateId, input, capacity) => {
      dependencies.requireCandidate(candidateId);
      return insertExecutiveRequest(
        dependencies.database,
        dependencies.sealedText,
        dependencies.transaction,
        candidateId,
        input,
        capacity,
      );
    },
    listExecutiveRequests: (candidateId, query) => {
      dependencies.requireCandidate(candidateId);
      return selectExecutiveRequests(
        dependencies.database,
        dependencies.sealedText,
        candidateId,
        query,
      );
    },
    getExecutiveRequest: (candidateId, requestId) => {
      dependencies.requireCandidate(candidateId);
      return selectExecutiveRequest(
        dependencies.database,
        dependencies.sealedText,
        candidateId,
        requestId,
      );
    },
    listExecutiveRequestQueue: (query) =>
      selectExecutiveRequestQueue(dependencies.database, dependencies.sealedText, query),
    setExecutiveRequestStatus: (requestId, status, capacity) =>
      updateExecutiveRequestStatus(
        dependencies.database,
        dependencies.sealedText,
        dependencies.transaction,
        requestId,
        status,
        capacity,
      ),
  };
}
