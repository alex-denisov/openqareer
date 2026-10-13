import type {
  CandidateAutomationConsent,
  CandidateAutomationJournalEntry,
  CandidateAutomationMode,
  CandidateAutomationRuntime,
  CandidateAutomationSettings,
  CandidateAutomationStopCompany,
} from '../../../server/candidate/sqliteCandidateAutomationRepository';
import type {
  CandidateAutomationQueueStatus,
  CandidateAutomationRules,
} from '../../../server/domain/candidateAutomation';
import type { CandidateAutomationDeliveryStats } from '../../../server/candidate/sqliteCandidateAutomationScheduleRepository';
import type { CandidateAutomationSchedule } from '../../../server/candidate/candidateAutomationScheduler';
import { apiFetch, readDataObject, throwApiError } from '../coach/apiClient';

export interface CandidateAutomationSnapshot {
  readonly settings: CandidateAutomationSettings;
  readonly consents: readonly CandidateAutomationConsent[];
  readonly stopCompanies: readonly CandidateAutomationStopCompany[];
  readonly queueCounts: Readonly<Record<CandidateAutomationQueueStatus, number>>;
  readonly deliveryStats?: CandidateAutomationDeliveryStats;
  readonly schedule: CandidateAutomationSchedule;
  readonly schedulerRuntime: CandidateAutomationRuntime;
  readonly linkedinPublishing: { readonly enabled: false; readonly reason: string };
}

export interface AutomationQueueItem {
  readonly id: string;
  readonly candidateId: string;
  readonly applicationId: string | null;
  readonly status: CandidateAutomationQueueStatus;
  readonly displayStatus: string;
  readonly sendTiming: 'today' | 'later';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly clusterId: string;
  readonly platform: 'hh' | 'linkedin';
  readonly title: string;
  readonly role: string;
  readonly company: string;
  readonly requirements: { readonly matched: number; readonly total: number };
  readonly letterReady: boolean;
  readonly materialCount: number;
}

export interface AutomationQueuePage {
  readonly items: AutomationQueueItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface AutomationQueuePreview {
  readonly id: string;
  readonly status: CandidateAutomationQueueStatus;
  readonly sendTiming: 'today' | 'later';
  readonly title: string;
  readonly company: string;
  readonly role: string;
  readonly platform: 'hh' | 'linkedin';
  readonly targetUrl: string;
  readonly requirements: { readonly matched: number; readonly total: number };
  readonly letterText: string;
  readonly materials: readonly {
    readonly documentId: string;
    readonly kind: string;
    readonly fileName: string;
    readonly version: number;
  }[];
}

export interface AutomationJournalPage {
  readonly entries: CandidateAutomationJournalEntry[];
  readonly periodDays: number;
  readonly counts: {
    readonly total: number;
    readonly delivered: number;
    readonly errors: number;
    readonly removed: number;
  };
  readonly limit?: number;
  readonly offset?: number;
}

export interface AutomationQueueFilter {
  readonly status?: CandidateAutomationQueueStatus;
  readonly platform?: 'hh' | 'linkedin';
  readonly limit?: number;
  readonly offset?: number;
}

export type AutomationQueueAction = 'approve_and_send' | 'remove' | 'stop_company' | 'consultant';

export async function getCandidateAutomation(): Promise<CandidateAutomationSnapshot> {
  const response = await apiFetch('/api/v1/candidate/automation');
  return readDataObject<CandidateAutomationSnapshot>(response);
}

export async function enableCandidateAutomation(input: {
  readonly mode: CandidateAutomationMode;
  readonly consentKeys: readonly string[];
  readonly rules?: CandidateAutomationRules;
}): Promise<{ readonly settings: CandidateAutomationSettings; readonly consents: CandidateAutomationConsent[] }> {
  const response = await apiFetch('/api/v1/candidate/automation/enable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readDataObject(response);
}

export async function disableCandidateAutomation(): Promise<void> {
  const response = await apiFetch('/api/v1/candidate/automation/disable', { method: 'POST' });
  await readDataObject(response);
}

export async function revokeCandidateAutomationConsent(key: string): Promise<void> {
  const response = await apiFetch(`/api/v1/candidate/automation/consents/${encodeURIComponent(key)}/revoke`, { method: 'POST' });
  await readDataObject(response);
}

export async function updateCandidateAutomationRules(
  rules: CandidateAutomationRules,
): Promise<CandidateAutomationSettings> {
  const response = await apiFetch('/api/v1/candidate/automation/rules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rules),
  });
  return readDataObject<{ settings: CandidateAutomationSettings }>(response).then((value) => value.settings);
}

export async function listCandidateAutomationQueue(
  filter: AutomationQueueFilter = {},
): Promise<AutomationQueuePage> {
  const query = new URLSearchParams({
    limit: String(filter.limit ?? 100),
    offset: String(filter.offset ?? 0),
  });
  if (filter.status) query.set('status', filter.status);
  if (filter.platform) query.set('platform', filter.platform);
  const response = await apiFetch(`/api/v1/candidate/automation/queue?${query}`);
  return readDataObject<AutomationQueuePage>(response);
}

export async function refreshCandidateAutomationQueue(
  clusterIds: readonly string[],
): Promise<{ readonly added: number; readonly skipped: number; readonly items: AutomationQueueItem[] }> {
  const response = await apiFetch('/api/v1/candidate/automation/queue/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opportunities: clusterIds.map((clusterId) => ({ clusterId, materialDocumentIds: [] })) }),
  });
  return readDataObject(response);
}

export async function actOnCandidateAutomationQueueItem(
  id: string,
  action: AutomationQueueAction,
): Promise<{ readonly item: AutomationQueueItem | null; readonly execution: string }> {
  const response = await apiFetch(`/api/v1/candidate/automation/queue/${encodeURIComponent(id)}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  return readDataObject(response);
}

export async function previewCandidateAutomationQueueItem(id: string): Promise<AutomationQueuePreview> {
  const response = await apiFetch(`/api/v1/candidate/automation/queue/${encodeURIComponent(id)}/preview`);
  return readDataObject(response);
}

export async function updateCandidateAutomationLetter(id: string, letterText: string): Promise<void> {
  const response = await apiFetch(`/api/v1/candidate/automation/queue/${encodeURIComponent(id)}/letter`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ letterText }),
  });
  await readDataObject(response);
}

export async function pauseCandidateAutomation(days: number): Promise<void> {
  const response = await apiFetch('/api/v1/candidate/automation/pause', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days }),
  });
  await readDataObject(response);
}

export async function resumeCandidateAutomation(): Promise<void> {
  const response = await apiFetch('/api/v1/candidate/automation/pause', { method: 'DELETE' });
  await readDataObject(response);
}

export async function getCandidateAutomationSchedule(): Promise<{
  readonly schedule: CandidateAutomationSchedule;
  readonly runtime: CandidateAutomationRuntime;
  readonly stateLabel: string;
}> {
  const response = await apiFetch('/api/v1/candidate/automation/schedule');
  return readDataObject(response);
}

export async function saveCandidateAutomationSchedule(
  schedule: CandidateAutomationSchedule,
): Promise<CandidateAutomationSchedule> {
  const response = await apiFetch('/api/v1/candidate/automation/schedule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(schedule),
  });
  return readDataObject<{ schedule: CandidateAutomationSchedule }>(response).then((value) => value.schedule);
}

export async function pauseCandidateAutomationImmediately(): Promise<void> {
  const response = await apiFetch('/api/v1/candidate/automation/emergency-pause', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  await readDataObject(response);
}

export async function listCandidateAutomationJournal(options: {
  readonly periodDays: number;
  readonly result?: 'delivered' | 'error' | 'removed';
  readonly platform?: 'hh' | 'linkedin';
  readonly limit?: number;
  readonly offset?: number;
}): Promise<AutomationJournalPage> {
  const query = new URLSearchParams({
    periodDays: String(options.periodDays),
    limit: String(options.limit ?? 100),
    offset: String(options.offset ?? 0),
  });
  if (options.result) query.set('result', options.result);
  if (options.platform) query.set('platform', options.platform);
  const response = await apiFetch(`/api/v1/candidate/automation/journal?${query}`);
  return readDataObject<AutomationJournalPage>(response);
}

export async function exportCandidateAutomationJournal(): Promise<string> {
  const response = await apiFetch('/api/v1/candidate/automation/journal/export');
  if (!response.ok) await throwApiError(response);
  return response.text();
}

export async function listCandidateStopCompanies(): Promise<CandidateAutomationStopCompany[]> {
  const response = await apiFetch('/api/v1/candidate/automation/stop-companies');
  return readDataObject<{ stopCompanies: CandidateAutomationStopCompany[] }>(response).then(
    (value) => value.stopCompanies,
  );
}

export async function addCandidateStopCompany(company: string): Promise<void> {
  const response = await apiFetch('/api/v1/candidate/automation/stop-companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company }),
  });
  await readDataObject(response);
}

export async function removeCandidateStopCompany(company: string): Promise<void> {
  const response = await apiFetch('/api/v1/candidate/automation/stop-companies', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company }),
  });
  await readDataObject(response);
}
