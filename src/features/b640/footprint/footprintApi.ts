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

/** B645 p02: «Это не проблема» у расхождения с резюме и её отмена. */
export async function reviewFootprintMismatch(
  mismatchId: string,
  review: 'hidden' | 'unreviewed',
): Promise<void> {
  const response = await apiFetch(
    `/api/v1/candidate/footprint/mismatches/${encodeURIComponent(mismatchId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review }),
    },
  );
  await readData<object>(response);
}

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
