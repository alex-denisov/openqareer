import type { ApplicationTrackerController } from './store/applicationTrackerController';

/**
 * Кандидат убирает запись, внесённую по ошибке или для проверки: оффер или интервью отклика.
 * Чужой или несуществующий отклик — `ApplicationNotFoundError`, как и у правки записи.
 */
export interface ApplicationRecordRemovalMethods {
  /** `false`, если такого интервью в отклике нет. */
  deleteApplicationInterview(candidateId: string, applicationId: string, interviewId: string): boolean;
  /** `false`, если оффера у отклика нет. */
  deleteApplicationOffer(candidateId: string, applicationId: string): boolean;
}

export function createRecordRemoval(
  tracker: Pick<ApplicationTrackerController, 'deleteInterview' | 'deleteOffer'>,
  requireCandidate: (candidateId: string) => void,
): ApplicationRecordRemovalMethods {
  return {
    deleteApplicationInterview(candidateId, applicationId, interviewId) {
      requireCandidate(candidateId);
      return tracker.deleteInterview(candidateId, applicationId, interviewId);
    },
    deleteApplicationOffer(candidateId, applicationId) {
      requireCandidate(candidateId);
      return tracker.deleteOffer(candidateId, applicationId);
    },
  };
}
