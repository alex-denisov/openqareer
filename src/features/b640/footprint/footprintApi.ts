import type { FootprintRiskSummary } from '../../../../shared/footprintRisk';
import { apiFetch, readData } from '../../coach/apiClient';

export {
  addCandidateFootprintFindingToProfile,
  getCandidateFootprintPlan,
  reviewCandidateFootprintFinding,
  startCandidateFootprintAudit,
  type CandidateFootprintPlanResponse,
} from '../../reputation/candidateFootprintApi';
export {
  getAccountCapabilityConsents,
  grantAccountCapabilityConsent,
  revokeAccountCapabilityConsent,
} from '../../account/accountCapabilityConsentApi';

/** B667: сводка следа по пяти категориям риска (маршрут закрыт флагом B640). */
export async function getFootprintRisks(): Promise<FootprintRiskSummary> {
  const response = await apiFetch('/api/v1/candidate/footprint/risks', { cache: 'no-store' });
  return readData<FootprintRiskSummary>(response);
}
