import type {
  CandidateIdentity,
  CandidateStore,
  StartedTurn,
  TurnRequest,
} from './candidateStore';
import type { CoachProviderResult } from '../providers/coachProvider';
import type { ConsultantHistoryStore } from './store/consultantHistoryStore';
import type { ConversationController } from './store/conversationController';

type PublicHistoryMethods = Pick<CandidateStore,
  | 'completeTurn'
  | 'listConsultantConversations'
  | 'getConsultantConversation'
  | 'deleteConsultantConversation'
  | 'exportConsultantConversations'
  | 'listPendingConsultantSummaries'
  | 'getConsultantSummaryInput'
  | 'saveConsultantSummary'
  | 'claimConsultantSummary'
  | 'releaseConsultantSummaryClaim'>;

export interface ConsultantStoreMethods extends PublicHistoryMethods {
  decorateTurn(started: StartedTurn, candidateId: string, key: string, request: TurnRequest): StartedTurn;
}

export function createSqliteCandidateStoreConsultantMethods(input: {
  history: ConsultantHistoryStore;
  conversations: ConversationController;
  requireCandidate(candidateId: string): CandidateIdentity;
  transaction<T>(operation: () => T): T;
}): ConsultantStoreMethods {
  return {
    decorateTurn: (started, candidateId, key, request) => decorateTurn(input.history, started, candidateId, key, request),
    completeTurn(candidateId, key, result: CoachProviderResult) {
      input.requireCandidate(candidateId);
      input.transaction(() => {
        input.conversations.completeTurn(candidateId, key, result);
        input.history.recordAssistantTurn(candidateId, key);
      });
    },
    ...createPublicHistoryMethods(input),
  };
}

function createPublicHistoryMethods(
  input: Parameters<typeof createSqliteCandidateStoreConsultantMethods>[0],
): Omit<ConsultantStoreMethods, 'decorateTurn' | 'completeTurn'> {
  const requireCandidate = (candidateId: string) => input.requireCandidate(candidateId);
  return {
    listConsultantConversations(candidateId, options) {
      requireCandidate(candidateId);
      return input.transaction(() => input.history.list(candidateId, options));
    },
    getConsultantConversation(candidateId, conversationId) {
      requireCandidate(candidateId);
      return input.transaction(() => input.history.get(candidateId, conversationId));
    },
    deleteConsultantConversation(candidateId, conversationId) {
      requireCandidate(candidateId);
      return input.transaction(() => input.history.delete(candidateId, conversationId));
    },
    exportConsultantConversations(candidateId) {
      requireCandidate(candidateId);
      return input.transaction(() => input.history.export(candidateId));
    },
    listPendingConsultantSummaries(candidateId) {
      requireCandidate(candidateId);
      return input.transaction(() => input.history.pendingSummaryTasks(candidateId));
    },
    getConsultantSummaryInput(candidateId, task) {
      return input.history.getSummaryInput(candidateId, task, requireCandidate(candidateId));
    },
    saveConsultantSummary(candidateId, task, result) {
      requireCandidate(candidateId);
      return input.transaction(() => input.history.saveSummary(candidateId, task, result));
    },
    claimConsultantSummary(candidateId, task) {
      requireCandidate(candidateId);
      return input.transaction(() => input.history.claimSummary(candidateId, task, new Date().toISOString()));
    },
    releaseConsultantSummaryClaim(candidateId, task) {
      requireCandidate(candidateId);
      input.transaction(() => input.history.releaseSummaryClaim(candidateId, task));
    },
  };
}

function decorateTurn(
  history: ConsultantHistoryStore,
  started: StartedTurn,
  candidateId: string,
  key: string,
  request: TurnRequest,
): StartedTurn {
  if (started.state !== 'ready' || request.isService) return started;
  const { currentConversationId } = history.recordUserTurn(candidateId, key, request);
  const tasks = history.pendingSummaryTasks(candidateId);
  const stage = request.stage ?? 'today';
  return {
    ...started,
    closedConversations: tasks,
    input: {
      ...started.input,
      messages: history.activeMessages(candidateId, currentConversationId),
      knowledgeContext: history.buildHistoryContext(candidateId, stage, request.content, started.input.knowledgeContext),
    },
  };
}
