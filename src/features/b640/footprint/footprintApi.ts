import type { FootprintRemoval } from '../../../../shared/footprintRemoval';
import type { FootprintRiskSummary } from '../../../../shared/footprintRisk';
import { apiFetch, readData, throwApiError } from '../../coach/apiClient';

export {
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

/** B668: ссылка, добавленная в «Данные для поиска», входит в «Проверить снова». */
export async function rememberAddedLink(link: string): Promise<void> {
  const response = await apiFetch('/api/v1/candidate/footprint/added-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ link }),
  });
  if (!response.ok) await throwApiError(response);
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

const profileFactUrl = (findingId: string): string =>
  `/api/v1/candidate/footprint/findings/${encodeURIComponent(findingId)}/profile-fact`;

/** B382: «В профиль»; `alreadyInProfile` — такой факт уже был, второй не записан («Уже в профиле»). */
export async function addFindingToProfile(
  findingId: string,
): Promise<{ readonly alreadyInProfile: boolean }> {
  const response = await apiFetch(profileFactUrl(findingId), { method: 'POST' });
  const data = await readData<{ readonly alreadyInProfile?: boolean }>(response);
  return { alreadyInProfile: data.alreadyInProfile === true };
}

/** B382: «Отменить» после «В профиль» — факт из находки удаляется, отметка снимается. */
export async function removeFindingFromProfile(findingId: string): Promise<void> {
  await readData<unknown>(await apiFetch(profileFactUrl(findingId), { method: 'DELETE' }));
}
