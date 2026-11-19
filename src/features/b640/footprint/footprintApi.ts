import type { FootprintRemoval } from '../../../../shared/footprintRemoval';
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

interface RemovalResponse {
  readonly findingId: string;
  readonly removal: FootprintRemoval;
}

/** B382: «Письмо отправлено» — дата запроса на удаление сохраняется у находки. */
export async function markRemovalRequested(findingId: string): Promise<FootprintRemoval> {
  const response = await apiFetch(
    `/api/v1/candidate/footprint/findings/${encodeURIComponent(findingId)}/removal-request`,
    { method: 'POST' },
  );
  return (await readData<RemovalResponse>(response)).removal;
}

/** B382: «Проверить находку» — сервер открывает адрес находки и сохраняет итог. */
export async function recheckFinding(findingId: string): Promise<FootprintRemoval> {
  const response = await apiFetch(
    `/api/v1/candidate/footprint/findings/${encodeURIComponent(findingId)}/recheck`,
    { method: 'POST' },
  );
  return (await readData<RemovalResponse>(response)).removal;
}
