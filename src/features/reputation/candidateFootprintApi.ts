import type {
  CandidateFootprintAdapterStatus,
  CandidateFootprintAudit,
  CandidateFootprintConsentState,
  FootprintReview,
  FootprintAdapterId,
} from '../../../shared/candidateFootprint';
import type { PublicFootprintQueryPlanItem } from '../../../server/osint/candidateFootprintQueryPlan';
import { apiFetch, readData } from '../coach/apiClient';

export interface CandidateFootprintPlanResponse {
  readonly plan: readonly PublicFootprintQueryPlanItem[];
  readonly sourceAvailability: Readonly<Record<FootprintAdapterId, boolean>>;
  readonly consent: CandidateFootprintConsentState;
  readonly audit: CandidateFootprintAudit | null;
}

export async function getCandidateFootprintPlan(): Promise<CandidateFootprintPlanResponse> {
  const response = await apiFetch('/api/v1/candidate/footprint/plan');
  return readData<CandidateFootprintPlanResponse>(response);
}

export async function getCandidateFootprintAudit(): Promise<CandidateFootprintAudit | null> {
  const response = await apiFetch('/api/v1/candidate/footprint');
  const data = await readData<{ audit: CandidateFootprintAudit | null }>(response);
  return data.audit;
}

export async function startCandidateFootprintAudit(
  selectedQueryIds: readonly string[],
): Promise<CandidateFootprintAudit> {
  const response = await apiFetch('/api/v1/candidate/footprint/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selectedQueryIds, confirmedOwnership: true }),
  });
  const data = await readData<{ audit: CandidateFootprintAudit }>(response);
  return data.audit;
}

export async function reviewCandidateFootprintFinding(
  findingId: string,
  review: FootprintReview,
): Promise<CandidateFootprintAudit> {
  const response = await apiFetch(`/api/v1/candidate/footprint/findings/${findingId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ review }),
  });
  const data = await readData<{ audit: CandidateFootprintAudit }>(response);
  return data.audit;
}

export async function deleteCandidateFootprintFindings(): Promise<void> {
  const response = await apiFetch('/api/v1/candidate/footprint', { method: 'DELETE' });
  if (!response.ok) {
    await readData<never>(response);
  }
}

export async function grantCandidateFootprintConsent(versionId: string): Promise<void> {
  const response = await apiFetch('/api/v1/me/consents/digital_footprint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId }),
  });
  await readData<{ granted: true }>(response);
}

export async function revokeCandidateFootprintConsent(): Promise<void> {
  const response = await apiFetch('/api/v1/me/consents/digital_footprint', { method: 'DELETE' });
  await readData<{ granted: false; revoked: true }>(response);
}

export function statusMessage(status: CandidateFootprintAdapterStatus): string {
  switch (status.state) {
    case 'pending': return 'проверяется';
    case 'not_connected': return 'источник не подключён';
    case 'source_error': return 'ошибка источника';
    case 'not_run': return 'не запускалось';
    case 'checked': return status.findingsCount ? 'проверено' : 'ничего не найдено';
  }
}
