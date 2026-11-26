import type { CoachTurnInput, CoachTurnResult, CoachTurnStage } from '../domain/coach';
import type { CoachProviderResult } from '../providers/coachProvider';
import type {
  ConsultantConversationDetail,
  ConsultantConversationExport,
  ConsultantConversationPage,
  ConsultantSummaryTask,
} from './candidateStore';

/**
 * Разговоры консультанта и их сводки (B436). B688 добавил «Новый разговор»
 * (`closeConsultantConversation`, `null` — открытого не было), продолжение
 * закрытого и открытый разговор для ленты панели раздела.
 */
export interface ConsultantHistoryMethods {
  listConsultantConversations(
    candidateId: string,
    options?: { readonly cursor?: string; readonly limit?: number },
  ): ConsultantConversationPage;
  getConsultantConversation(
    candidateId: string,
    conversationId: string,
  ): ConsultantConversationDetail | null;
  deleteConsultantConversation(candidateId: string, conversationId: string): boolean;
  closeConsultantConversation(candidateId: string): string | null;
  resumeConsultantConversation(candidateId: string, conversationId: string): ConsultantConversationDetail | null;
  currentConsultantConversation(candidateId: string, stage: CoachTurnStage): ConsultantConversationDetail | null;
  /** B688: результаты завершённых ходов разговора по id ответа консультанта. */
  consultantReplyResults(
    candidateId: string,
    conversationId: string,
  ): Array<{ readonly messageId: string; readonly result: CoachTurnResult }>;
  exportConsultantConversations(candidateId: string): ConsultantConversationExport[];
  listPendingConsultantSummaries(candidateId: string): ConsultantSummaryTask[];
  getConsultantSummaryInput(
    candidateId: string,
    task: ConsultantSummaryTask,
  ): CoachTurnInput | null;
  saveConsultantSummary(
    candidateId: string,
    task: ConsultantSummaryTask,
    result: CoachProviderResult,
  ): boolean;
  claimConsultantSummary(candidateId: string, task: ConsultantSummaryTask): boolean;
  releaseConsultantSummaryClaim(candidateId: string, task: ConsultantSummaryTask): void;
}
