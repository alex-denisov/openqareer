import type { ApplicationView } from '../../../server/domain/applicationDerivedFields';
import type { ApplicationStage, DeliveryReceipt } from '../../../shared/applicationStage';
import type { SkipReasonId } from '../../../shared/skipReasons';
import type { VacancyApplicationSnapshot } from '../../../shared/vacancyApplication';
import { apiFetch, readData, readDataArray, readDataObject } from '../coach/apiClient';

export type { ApplicationView } from '../../../server/domain/applicationDerivedFields';

/** `code` on a `CoachApiError` thrown by `patchApplication` (server/routes/runtime.ts). */
export const APPLICATION_VERSION_CONFLICT_CODE = 'application_version_conflict';

export interface ManualVacancyInput {
  readonly title: string;
  readonly company?: string;
  readonly companyHidden?: boolean;
  readonly source: 'recruiter' | 'other';
  readonly url?: string;
}

export interface CreateApplicationInput {
  readonly clusterId?: string;
  readonly manualVacancy?: ManualVacancyInput | VacancyApplicationSnapshot;
  readonly stage: ApplicationStage;
  readonly occurredAt?: string;
}

export interface PatchApplicationInput {
  readonly expectedVersion: number;
  readonly stage?: ApplicationStage;
  readonly occurredAt?: string;
  readonly notes?: string | null;
  readonly followUpDueAt?: string | null;
  readonly deliveryReceipt?: DeliveryReceipt | null;
}

/** Minutes east of UTC, the shape `?tz=` and `shared/followUpPolicy` expect. */
export function localTimezoneOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

export async function listApplications(signal?: AbortSignal): Promise<ApplicationView[]> {
  const tz = localTimezoneOffsetMinutes();
  const response = await apiFetch(`/api/v1/candidate/applications?tz=${tz}`, { signal });
  return readDataArray<ApplicationView>(response);
}

export async function createApplication(input: CreateApplicationInput): Promise<ApplicationView> {
  const response = await apiFetch('/api/v1/candidate/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readDataObject<ApplicationView>(response);
}

export async function patchApplication(
  id: string,
  input: PatchApplicationInput,
): Promise<ApplicationView> {
  const response = await apiFetch(`/api/v1/candidate/applications/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readDataObject<ApplicationView>(response);
}

export async function restoreApplicationFromArchive(
  id: string,
  expectedVersion: number,
): Promise<ApplicationView> {
  const response = await apiFetch(`/api/v1/candidate/applications/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion }),
  });
  return readDataObject<ApplicationView>(response);
}

export interface ScheduleApplicationInterviewInput {
  readonly round: number;
  readonly scheduledAt?: string | null;
}

export interface CreatedApplicationInterview {
  readonly id: string;
  readonly applicationId: string;
  readonly round: number;
  readonly scheduledAt: string | null;
  readonly prepStatus: 'none' | 'ready';
}

/** Creates the interview record the stage change alone does not: `stage` and
 * `nearestInterview` live in separate tables (server/data/sqliteApplicationInterviewRepository.ts,
 * B251 S2), so «Интервью через N дней» on «Сегодня» stays empty without this call. */
export async function createApplicationInterview(
  applicationId: string,
  input: ScheduleApplicationInterviewInput,
): Promise<CreatedApplicationInterview> {
  const response = await apiFetch(
    `/api/v1/candidate/applications/${encodeURIComponent(applicationId)}/interviews`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return readDataObject<CreatedApplicationInterview>(response);
}

export async function recordFollowUpSent(applicationId: string): Promise<ApplicationView> {
  const response = await apiFetch(
    `/api/v1/candidate/applications/${encodeURIComponent(applicationId)}/events`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'follow_up_sent', occurredAt: new Date().toISOString() }),
    },
  );
  return readDataObject<ApplicationView>(response);
}

export interface CreatedVacancySkip {
  readonly candidateId: string;
  readonly clusterId: string;
  readonly reasonId: SkipReasonId;
}

export async function createVacancySkip(input: {
  readonly clusterId: string;
  readonly reasonId: SkipReasonId;
  readonly origin: 'vacancy_card' | 'kanban';
}): Promise<CreatedVacancySkip> {
  const response = await apiFetch('/api/v1/candidate/vacancy-skips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readDataObject<CreatedVacancySkip>(response);
}

export type ApplicationFunnel = Record<ApplicationStage, number> & { opened: number };

export async function getApplicationFunnel(signal?: AbortSignal): Promise<ApplicationFunnel> {
  const response = await apiFetch('/api/v1/candidate/applications/funnel', { signal });
  return readDataObject<ApplicationFunnel>(response);
}

export type {
  ApplicationOfferTerms,
  StoredApplicationOffer,
} from '../../../server/data/sqliteApplicationOfferRepository';

export async function getApplicationOffer(
  applicationId: string,
): Promise<import('../../../server/data/sqliteApplicationOfferRepository').StoredApplicationOffer | null> {
  const response = await apiFetch(
    `/api/v1/candidate/applications/${encodeURIComponent(applicationId)}/offer`,
  );
  return readData<import('../../../server/data/sqliteApplicationOfferRepository').StoredApplicationOffer | null>(response);
}

export async function listApplicationOffers(): Promise<
  import('../../../server/data/sqliteApplicationOfferRepository').StoredApplicationOffer[]
> {
  const response = await apiFetch('/api/v1/candidate/applications/offers');
  return readDataArray<import('../../../server/data/sqliteApplicationOfferRepository').StoredApplicationOffer>(response);
}

export async function saveApplicationOffer(
  applicationId: string,
  terms: import('../../../server/data/sqliteApplicationOfferRepository').ApplicationOfferTerms,
  respondBy?: string | null,
): Promise<import('../../../server/data/sqliteApplicationOfferRepository').StoredApplicationOffer> {
  const response = await apiFetch(
    `/api/v1/candidate/applications/${encodeURIComponent(applicationId)}/offer`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terms, respondBy }),
    },
  );
  return readDataObject<import('../../../server/data/sqliteApplicationOfferRepository').StoredApplicationOffer>(response);
}

