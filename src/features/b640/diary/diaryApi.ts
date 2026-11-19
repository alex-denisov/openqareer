import type {
  CareerDiaryOverview,
  CareerDiaryMeasurement,
  CareerDiaryMeasurementInput,
  CareerDiaryGoalPatch,
  CareerDiaryPage,
} from '../../../../shared/careerDiary';
import type {
  CareerDiaryGoalCard,
  CareerDiaryGoalCardInput,
  CareerDiaryGoalCards,
  CareerDiaryGoalDetails,
} from '../../../../shared/careerDiaryCards';
import type {
  CareerDiaryEntry,
  CareerDiaryEntryFeed,
  CareerDiaryEntryInput,
  CareerDiaryEntryKind,
  CareerDiaryEntryPatch,
  CareerDiaryWeekDraft,
  CareerDiaryWeekSummary,
  CareerDiaryWeekSummaryInput,
} from '../../../../shared/careerDiaryEntries';
import type {
  CareerDiaryKpiAcceptInput,
  CareerDiaryKpiImport,
  CareerDiaryKpiImportInput,
} from '../../../../shared/careerDiaryKpi';
import { apiFetch, readData } from '../../coach/apiClient';

/** Клиент маршрутов дневника B683/B684 для экранов раздела (все под флагом B640). */
const ROOT = '/api/v1/candidate/career-diary';

async function read<T>(path: string, init?: RequestInit): Promise<T> {
  return readData<T>(await apiFetch(path, init));
}

function json(method: 'POST' | 'PATCH' | 'PUT', body: unknown, idempotent = false): RequestInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idempotent) headers['Idempotency-Key'] = crypto.randomUUID();
  return { method, headers, body: JSON.stringify(body) };
}

export interface EntryFilter {
  readonly kind?: CareerDiaryEntryKind;
  readonly goalId?: string;
}

export function listEntries(
  filter: EntryFilter = {},
  cursor?: string,
): Promise<CareerDiaryEntryFeed> {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  if (filter.kind) query.set('kind', filter.kind);
  if (filter.goalId) query.set('goalId', filter.goalId);
  return read(`${ROOT}/entries?${query.toString()}`);
}

export function createEntry(input: CareerDiaryEntryInput): Promise<CareerDiaryEntry> {
  return read(`${ROOT}/entries`, json('POST', input));
}

export function updateEntry(
  entryId: string,
  patch: CareerDiaryEntryPatch,
): Promise<CareerDiaryEntry> {
  return read(`${ROOT}/entries/${encodeURIComponent(entryId)}`, json('PATCH', patch));
}

export async function deleteEntry(entryId: string): Promise<void> {
  await read(`${ROOT}/entries/${encodeURIComponent(entryId)}`, { method: 'DELETE' });
}

export function getWeek(weekStart: string): Promise<CareerDiaryWeekDraft> {
  return read(`${ROOT}/weeks/${encodeURIComponent(weekStart)}`);
}

export function saveWeek(
  weekStart: string,
  input: CareerDiaryWeekSummaryInput,
): Promise<CareerDiaryWeekSummary> {
  return read(`${ROOT}/weeks/${encodeURIComponent(weekStart)}`, json('PUT', input));
}

export function listGoalCards(): Promise<CareerDiaryGoalCards> {
  return read(`${ROOT}/goal-cards`);
}

export function getOverview(): Promise<CareerDiaryOverview> {
  return read(ROOT);
}

export function recordMeasurement(
  goalId: string,
  input: CareerDiaryMeasurementInput,
): Promise<CareerDiaryMeasurement> {
  return read(
    `${ROOT}/goals/${encodeURIComponent(goalId)}/measurements`,
    json('POST', input, true),
  );
}

export function listMeasurements(goalId: string): Promise<CareerDiaryPage<CareerDiaryMeasurement>> {
  return read(`${ROOT}/goals/${encodeURIComponent(goalId)}/measurements?limit=20`);
}

export function archiveGoal(goalId: string, reason: string): Promise<CareerDiaryGoalCard> {
  return read(`${ROOT}/goal-cards/${encodeURIComponent(goalId)}/archive`, json('PUT', { reason }));
}

export function restoreGoal(goalId: string): Promise<CareerDiaryGoalCard> {
  return read(`${ROOT}/goal-cards/${encodeURIComponent(goalId)}/archive`, { method: 'DELETE' });
}

export function createGoalCard(input: CareerDiaryGoalCardInput): Promise<CareerDiaryGoalCard> {
  return read(`${ROOT}/goal-cards`, json('POST', input, true));
}

export function patchGoalDetails(
  goalId: string,
  patch: Partial<Pick<CareerDiaryGoalDetails, 'setBy' | 'agreedOn' | 'weight'>>,
): Promise<CareerDiaryGoalCard> {
  return read(`${ROOT}/goal-cards/${encodeURIComponent(goalId)}`, json('PATCH', patch));
}

export function patchGoal(goalId: string, patch: CareerDiaryGoalPatch): Promise<unknown> {
  return read(`${ROOT}/goals/${encodeURIComponent(goalId)}`, json('PATCH', patch));
}

const KPI = `${ROOT}/kpi-imports`;

/** B686: разбор KPI в черновик; ошибка несёт код (`kpi_rows_not_found`, `kpi_source_unreadable`…). */
export function createKpiImport(input: CareerDiaryKpiImportInput): Promise<CareerDiaryKpiImport> {
  return read(KPI, json('POST', input));
}

export function getKpiImport(id: string): Promise<CareerDiaryKpiImport> {
  return read(`${KPI}/${encodeURIComponent(id)}`);
}

export function acceptKpiImport(
  id: string,
  input: CareerDiaryKpiAcceptInput,
): Promise<{ readonly goalIds: readonly string[] }> {
  return read(`${KPI}/${encodeURIComponent(id)}/accept`, json('POST', input));
}

export function deleteKpiSource(id: string): Promise<CareerDiaryKpiImport> {
  return read(`${KPI}/${encodeURIComponent(id)}/source`, { method: 'DELETE' });
}
