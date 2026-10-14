import type { ApplicationView as StoredApplicationView } from '../../../server/domain/applicationDerivedFields';
import {
  APPLICATION_STAGES,
  type ApplicationStage,
  type DeliveryReceipt,
} from '../../../shared/applicationStage';
import type {
  CandidateActionKind,
  CandidateActionUsageSummary,
  CandidateDailyLimits,
} from '../../../shared/candidateActionPolicy';
import type { SkipReasonId } from '../../../shared/skipReasons';
import type { VacancyApplicationSnapshot } from '../../../shared/vacancyApplication';
import {
  apiFetch,
  CoachApiError,
  readData,
  readDataArray,
  readDataObject,
  throwApiError,
} from '../coach/apiClient';

export interface ApplicationLabelView {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

export type ApplicationView = StoredApplicationView & {
  readonly labels?: readonly ApplicationLabelView[];
};

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


export async function listApplicationLabels(signal?: AbortSignal): Promise<ApplicationLabelView[]> {
  const response = await apiFetch('/api/v1/candidate/application-labels', { signal });
  return readDataArray<ApplicationLabelView>(response);
}

export async function createApplicationLabel(name: string): Promise<ApplicationLabelView> {
  const response = await apiFetch('/api/v1/candidate/application-labels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return readDataObject<ApplicationLabelView>(response);
}

export async function assignApplicationLabel(applicationId: string, labelId: string): Promise<void> {
  const response = await apiFetch(
    `/api/v1/candidate/applications/${encodeURIComponent(applicationId)}/labels/${encodeURIComponent(labelId)}`,
    { method: 'PUT' },
  );
  await readDataObject<{ changed: boolean; label: ApplicationLabelView }>(response);
}

export async function removeApplicationLabel(applicationId: string, labelId: string): Promise<void> {
  const response = await apiFetch(
    `/api/v1/candidate/applications/${encodeURIComponent(applicationId)}/labels/${encodeURIComponent(labelId)}`,
    { method: 'DELETE' },
  );
  await readDataObject<{ changed: boolean }>(response);
}

export async function listApplications(signal?: AbortSignal): Promise<ApplicationView[]> {
  const tz = localTimezoneOffsetMinutes();
  const response = await apiFetch(`/api/v1/candidate/applications?tz=${tz}`, { signal });
  return readDataArray<ApplicationView>(response);
}

export interface ApplicationListQuery {
  readonly stage?: readonly ApplicationStage[];
  readonly channel?: readonly string[];
  readonly from?: string;
  readonly to?: string;
  readonly sort?: 'date' | 'company' | 'stage';
  readonly direction?: 'asc' | 'desc';
  readonly limit?: number;
  readonly offset?: number;
}

export interface ApplicationListPageMeta {
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly stageCounts: Record<ApplicationStage, number>;
}

export interface ApplicationListPage {
  readonly items: readonly ApplicationView[];
  readonly meta: ApplicationListPageMeta;
}

export type ApplicationBulkAction =
  | { readonly type: 'close' }
  | { readonly type: 'set_stage'; readonly stage: ApplicationStage }
  | { readonly type: 'retry' };

export interface ApplicationBulkResult {
  readonly state: 'prepared' | 'completed';
  readonly preparedCount?: number;
  readonly sentCount?: number;
  readonly changedCount: number;
  readonly stage?: ApplicationStage;
}

export type CompanyWantBulkAction = 'add' | 'set_next_step' | 'remove';

export interface CompanyWantBulkItem {
  readonly companyName: string;
  readonly nextStep?: string;
  readonly nextStepDueAt?: string | null;
}

export interface ApplicationBulkPreview {
  readonly affectedCount: number;
}

export async function listApplicationsPage(
  query: ApplicationListQuery = {},
  signal?: AbortSignal,
): Promise<ApplicationListPage> {
  const params = applicationQueryParams(query);
  const response = await apiFetch(`/api/v1/candidate/applications?${params.toString()}`, { signal });
  return parseApplicationListPage(response, query);
}

export async function listApplicationsPool(
  query: ApplicationListQuery = {},
  signal?: AbortSignal,
): Promise<ApplicationListPage> {
  const pageSize = 100;
  const firstPage = await listApplicationsPage(
    { ...query, stage: [], limit: pageSize, offset: 0 },
    signal,
  );
  if (firstPage.items.length >= firstPage.meta.total) return firstPage;
  const offsets = Array.from(
    { length: Math.ceil((firstPage.meta.total - firstPage.items.length) / pageSize) },
    (_, index) => firstPage.meta.offset + firstPage.items.length + index * pageSize,
  );
  const pages = await Promise.all(
    offsets.map((offset) =>
      listApplicationsPage({ ...query, stage: [], limit: pageSize, offset }, signal),
    ),
  );
  return {
    items: [...firstPage.items, ...pages.flatMap((page) => page.items)],
    meta: firstPage.meta,
  };
}

function applicationQueryParams(query: ApplicationListQuery): URLSearchParams {
  const params = new URLSearchParams({
    tz: String(localTimezoneOffsetMinutes()),
    limit: String(query.limit ?? 20),
    offset: String(query.offset ?? 0),
    sort: query.sort ?? 'date',
    direction: query.direction ?? 'desc',
  });
  query.stage?.forEach((stage) => params.append('stage', stage));
  query.channel?.forEach((channel) => params.append('channel', channel));
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  return params;
}

async function parseApplicationListPage(
  response: Response,
  query: ApplicationListQuery,
): Promise<ApplicationListPage> {
  if (!response.ok) await throwApiError(response);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CoachApiError('Сервис вернул ответ неожиданной формы. Повторите запрос.', 'malformed_response', true);
  }
  if (!payload || typeof payload !== 'object') {
    throw new CoachApiError('Сервис вернул ответ неожиданной формы. Повторите запрос.', 'malformed_response', true);
  }
  const body = payload as { data?: unknown; meta?: Partial<ApplicationListPageMeta> };
  if (!Array.isArray(body.data)) {
    throw new CoachApiError('Сервис вернул ответ неожиданной формы. Повторите запрос.', 'malformed_response', true);
  }
  const items = body.data as ApplicationView[];
  const meta = body.meta;
  if (meta?.stageCounts && typeof meta.total === 'number') {
    return {
      items,
      meta: {
        total: meta.total,
        offset: meta.offset ?? query.offset ?? 0,
        limit: meta.limit ?? query.limit ?? 20,
        stageCounts: meta.stageCounts,
      },
    };
  }
  return {
    items,
    meta: {
      total: items.length,
      offset: query.offset ?? 0,
      limit: query.limit ?? 20,
      stageCounts: countApplicationStages(items),
    },
  };
}

export async function previewApplicationBulk(
  filters: ApplicationListQuery,
  action: ApplicationBulkAction,
): Promise<ApplicationBulkPreview> {
  const response = await apiFetch('/api/v1/candidate/applications/bulk/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters: toApplicationFilters(filters), action }),
  });
  return readDataObject<ApplicationBulkPreview>(response);
}

export async function executeApplicationBulk(
  filters: ApplicationListQuery,
  action: ApplicationBulkAction,
  confirmCount: number,
): Promise<ApplicationBulkResult> {
  const response = await apiFetch('/api/v1/candidate/applications/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filters: toApplicationFilters(filters),
      action,
      operationId: globalThis.crypto.randomUUID(),
      confirmCount,
    }),
  });
  return readDataObject<ApplicationBulkResult>(response);
}

export async function previewCompanyWantBulk(
  action: CompanyWantBulkAction,
  companies: readonly CompanyWantBulkItem[],
): Promise<ApplicationBulkPreview> {
  const response = await apiFetch('/api/v1/candidate/applications/company-wants/bulk/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, companies }),
  });
  return readDataObject<ApplicationBulkPreview>(response);
}

export async function executeCompanyWantBulk(
  action: CompanyWantBulkAction,
  companies: readonly CompanyWantBulkItem[],
  confirmCount: number,
): Promise<{ readonly state: 'completed'; readonly changedCount: number }> {
  const response = await apiFetch('/api/v1/candidate/applications/company-wants/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, companies, operationId: globalThis.crypto.randomUUID(), confirmCount }),
  });
  return readDataObject(response);
}

function toApplicationFilters(query: ApplicationListQuery) {
  return {
    stage: query.stage ?? [],
    channel: query.channel ?? [],
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
  };
}

function countApplicationStages(applications: readonly ApplicationView[]): Record<ApplicationStage, number> {
  const counts = Object.fromEntries(APPLICATION_STAGES.map((stage) => [stage, 0])) as Record<
    ApplicationStage,
    number
  >;
  for (const application of applications) counts[application.stage] += 1;
  return counts;
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
  const response = await apiFetch(
    `/api/v1/candidate/applications/${encodeURIComponent(id)}/restore`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion }),
    },
  );
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

export interface PatchApplicationInterviewInput {
  readonly scheduledAt?: string | null;
  readonly format?: string | null;
  readonly prepStatus?: 'none' | 'ready';
  readonly prep?: string | null;
  readonly debrief?: string | null;
  readonly followUpDueAt?: string | null;
}

export async function patchApplicationInterview(
  applicationId: string,
  interviewId: string,
  input: PatchApplicationInterviewInput,
): Promise<CreatedApplicationInterview> {
  const response = await apiFetch(
    `/api/v1/candidate/applications/${encodeURIComponent(applicationId)}/interviews/${encodeURIComponent(interviewId)}`,
    {
      method: 'PATCH',
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
): Promise<
  import('../../../server/data/sqliteApplicationOfferRepository').StoredApplicationOffer | null
> {
  const response = await apiFetch(
    `/api/v1/candidate/applications/${encodeURIComponent(applicationId)}/offer`,
  );
  return readData<
    import('../../../server/data/sqliteApplicationOfferRepository').StoredApplicationOffer | null
  >(response);
}

export async function listApplicationOffers(): Promise<
  import('../../../server/data/sqliteApplicationOfferRepository').StoredApplicationOffer[]
> {
  const response = await apiFetch('/api/v1/candidate/applications/offers');
  return readDataArray<
    import('../../../server/data/sqliteApplicationOfferRepository').StoredApplicationOffer
  >(response);
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
  return readDataObject<
    import('../../../server/data/sqliteApplicationOfferRepository').StoredApplicationOffer
  >(response);
}

export interface CandidateActionInput {
  readonly id: string;
  readonly platform: 'hh' | 'linkedin';
  readonly actionKind: CandidateActionKind;
  readonly applicationId?: string;
  readonly targetUrl: string;
  readonly letterText?: string;
  readonly resumeId?: string;
}

export interface CandidateActionReceiptView {
  readonly id: string;
  readonly batchId: string;
  readonly platform: 'hh' | 'linkedin';
  readonly actionKind: CandidateActionKind;
  readonly status: 'pending' | 'delivered' | 'attempted' | 'failed';
  readonly applicationId?: string | null;
  readonly failureCode?: string | null;
  readonly executedAt: string;
}

export interface CandidateActionBatchView {
  readonly batchId: string;
  readonly status: 'completed' | 'partial_failure' | 'aborted';
  readonly receipts: readonly CandidateActionReceiptView[];
}

export interface CandidateActionUsageView {
  readonly usage: CandidateActionUsageSummary;
  readonly timezone: string;
  readonly resetAt: string;
  readonly killSwitchActive: boolean;
  readonly limits: CandidateDailyLimits;
}

export async function getCandidateActionUsage(
  signal?: AbortSignal,
): Promise<CandidateActionUsageView> {
  const response = await apiFetch('/api/v1/candidate/actions/usage', signal ? { signal } : {});
  return readDataObject<CandidateActionUsageView>(response);
}

export async function listCandidateActionReceipts(
  options: {
    readonly batchId?: string;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  } = {},
): Promise<CandidateActionReceiptView[]> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 100) });
  if (options.batchId) query.set('batchId', options.batchId);
  const response = await apiFetch(`/api/v1/candidate/actions/receipts?${query.toString()}`, {
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return readDataObject<{ receipts: CandidateActionReceiptView[] }>(response).then(
    (value) => value.receipts,
  );
}

export async function executeCandidateActionBatch(input: {
  readonly batchId: string;
  readonly confirmedByCandidate: boolean;
  readonly actions: readonly CandidateActionInput[];
}): Promise<CandidateActionBatchView> {
  const response = await apiFetch('/api/v1/candidate/actions/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readDataObject<CandidateActionBatchView>(response);
}

export async function setCandidateActionKillSwitch(active: boolean): Promise<void> {
  await apiFetch('/api/v1/candidate/actions/kill-switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active, reason: active ? 'candidate_requested_stop' : undefined }),
  });
}

export async function getActionsOnBehalfConsent(signal?: AbortSignal): Promise<{
  readonly granted: boolean;
  readonly consent: { readonly versionId: string; readonly grantedAt?: string } | null;
}> {
  const response = await apiFetch(
    '/api/v1/me/consents/actions_on_behalf',
    signal ? { signal } : {},
  );
  return readDataObject<{
    granted: boolean;
    consent: { versionId: string; grantedAt?: string } | null;
  }>(response);
}

export async function grantActionsOnBehalfConsent(versionId: string): Promise<void> {
  await apiFetch('/api/v1/me/consents/actions_on_behalf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId }),
  });
}
