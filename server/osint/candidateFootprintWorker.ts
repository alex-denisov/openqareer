import { randomUUID } from 'node:crypto';
import type {
  CandidateFootprintAdapterStatus,
  CandidateFootprintAudit,
  FootprintAdapterId,
} from '../../shared/candidateFootprint';
import type { SqliteCandidateReputationRepository } from '../data/sqliteCandidateReputationRepository';
import { FootprintSourceError, type FootprintAdapter } from './adapters/footprintAdapter';
import type { ExaAdapterInput } from './adapters/exaAdapter';
import type { HibpAdapterInput } from './adapters/hibpAdapter';
import type { UsernamePresenceInput } from './adapters/usernamePresenceAdapter';
import type { WaybackAdapterInput } from './adapters/waybackAdapter';
import type { FootprintQueryPlanItem } from './candidateFootprintQueryPlan';
import { mergeFootprintFindings } from './mergeFootprintFindings';
import type { FootprintAdapterSet } from './adapters/createFootprintAdapters';

type AdapterSet = FootprintAdapterSet;
type MutableStatus = {
  adapterId: FootprintAdapterId;
  state: CandidateFootprintAdapterStatus['state'];
  sourcesChecked: number;
  findingsCount: number;
  checkedAt?: string;
};

export interface CandidateFootprintWorkerInput {
  readonly candidateId: string;
  readonly userId: string;
  readonly plan: readonly FootprintQueryPlanItem[];
  readonly selectedQueryIds: readonly string[];
  readonly ownershipConfirmedAt: string;
  readonly repo: Pick<
    SqliteCandidateReputationRepository,
    'saveFootprintAudit' | 'getLatestFootprintAudit'
  >;
  readonly adapters: AdapterSet;
  readonly isAuthorized: () => boolean;
  readonly now?: () => Date;
}

interface ActiveRun {
  readonly auditId: string;
  readonly candidateId: string;
  readonly userId: string;
  readonly controller: AbortController;
  task: Promise<void>;
}

const activeRunsByAudit = new Map<string, ActiveRun>();
const activeAuditByCandidate = new Map<string, string>();
const ADAPTER_IDS: readonly FootprintAdapterId[] = ['sherlock', 'maigret', 'hibp', 'wayback', 'exa'];

export class FootprintConsentRequiredError extends Error {
  constructor() {
    super('Для запуска цифрового следа требуется утверждённое согласие кандидата.');
    this.name = 'FootprintConsentRequiredError';
  }
}

export class FootprintQueryPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FootprintQueryPlanError';
  }
}

function isAuthorized(input: CandidateFootprintWorkerInput): boolean {
  try {
    return input.isAuthorized();
  } catch {
    return false;
  }
}

function selectPlanItems(input: CandidateFootprintWorkerInput): readonly FootprintQueryPlanItem[] {
  const uniqueIds = new Set(input.selectedQueryIds);
  if (!uniqueIds.size || uniqueIds.size !== input.selectedQueryIds.length) {
    throw new FootprintQueryPlanError('Выберите хотя бы один пункт плана проверки.');
  }
  const planById = new Map(input.plan.map((item) => [item.id, item]));
  const selected = [...uniqueIds].map((id) => planById.get(id));
  if (selected.some((item) => !item)) {
    throw new FootprintQueryPlanError('План проверки изменился. Обновите страницу.');
  }
  return selected as FootprintQueryPlanItem[];
}

function makeStatuses(plan: readonly FootprintQueryPlanItem[]): Map<FootprintAdapterId, MutableStatus> {
  const selected = new Set(plan.map((item) => item.adapterId));
  return new Map(ADAPTER_IDS.map((adapterId) => [adapterId, {
    adapterId,
    state: selected.has(adapterId) ? 'pending' : 'not_run',
    sourcesChecked: 0,
    findingsCount: 0,
  }]));
}

function recordSourceFailure(status: MutableStatus, error: unknown, now: () => Date): void {
  status.state = error instanceof FootprintSourceError && error.failure === 'not_connected'
    ? 'not_connected'
    : 'source_error';
  status.checkedAt = now().toISOString();
}

async function callAdapter<I>(
  adapter: FootprintAdapter<I>,
  adapterInput: I,
  status: MutableStatus,
  input: CandidateFootprintWorkerInput,
  signal: AbortSignal,
  now: () => Date,
): Promise<readonly import('./adapters/footprintAdapter').FootprintFinding[]> {
  if (signal.aborted) throw signal.reason;
  if (!isAuthorized(input)) throw new FootprintConsentRequiredError();
  try {
    const findings = await adapter.run(adapterInput, signal);
    if (signal.aborted || !isAuthorized(input)) throw new FootprintConsentRequiredError();
    status.sourcesChecked += 1;
    status.findingsCount += findings.length;
    status.checkedAt = now().toISOString();
    if (status.state === 'pending') status.state = 'checked';
    return findings;
  } catch (error) {
    if (signal.aborted || !isAuthorized(input)) throw new FootprintConsentRequiredError();
    recordSourceFailure(status, error, now);
    return [];
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  map: (value: T) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function consume(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await map(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, consume));
  return results;
}

interface PresenceCall {
  readonly adapter: FootprintAdapter<UsernamePresenceInput>;
  readonly username: string;
}

function presenceCalls(
  adapterId: 'sherlock' | 'maigret',
  plan: readonly FootprintQueryPlanItem[],
  adapters: AdapterSet,
): readonly PresenceCall[] {
  const selected = plan.filter((item) => item.adapterId === adapterId);
  const usernameItems = selected.filter((item): item is FootprintQueryPlanItem & {
    readonly input: { readonly username: string };
  } => 'username' in item.input);
  const sites = adapters[adapterId];
  return usernameItems.flatMap((item) => sites.map((adapter) => ({
    adapter,
    username: item.input.username,
  })));
}

async function runPresence(
  adapterId: 'sherlock' | 'maigret',
  plan: readonly FootprintQueryPlanItem[],
  input: CandidateFootprintWorkerInput,
  statuses: Map<FootprintAdapterId, MutableStatus>,
  signal: AbortSignal,
  now: () => Date,
): Promise<readonly import('./adapters/footprintAdapter').FootprintFinding[]> {
  const status = statuses.get(adapterId)!;
  const calls = presenceCalls(adapterId, plan, input.adapters);
  const results = await mapWithConcurrency(calls, 5, (call) =>
    callAdapter(call.adapter, { username: call.username }, status, input, signal, now),
  );
  return results.flat();
}

async function runSingleInputAdapter<I>(
  adapter: FootprintAdapter<I>,
  adapterInput: I,
  adapterId: FootprintAdapterId,
  input: CandidateFootprintWorkerInput,
  statuses: Map<FootprintAdapterId, MutableStatus>,
  signal: AbortSignal,
  now: () => Date,
): Promise<readonly import('./adapters/footprintAdapter').FootprintFinding[]> {
  return callAdapter(adapter, adapterInput, statuses.get(adapterId)!, input, signal, now);
}

async function runExternalAdapters(
  plan: readonly FootprintQueryPlanItem[],
  input: CandidateFootprintWorkerInput,
  statuses: Map<FootprintAdapterId, MutableStatus>,
  signal: AbortSignal,
  now: () => Date,
): Promise<readonly import('./adapters/footprintAdapter').FootprintFinding[]> {
  const findings: import('./adapters/footprintAdapter').FootprintFinding[] = [];
  const emailItem = plan.find((item) => item.adapterId === 'hibp' && 'email' in item.input);
  if (emailItem && 'email' in emailItem.input) {
    findings.push(...await runSingleInputAdapter<HibpAdapterInput>(
      input.adapters.hibp, { email: emailItem.input.email }, 'hibp', input, statuses, signal, now,
    ));
  }
  for (const item of plan.filter((entry) => entry.adapterId === 'wayback')) {
    if (!('profileUrl' in item.input)) continue;
    findings.push(...await runSingleInputAdapter<WaybackAdapterInput>(
      input.adapters.wayback, { profileUrl: item.input.profileUrl }, 'wayback', input, statuses, signal, now,
    ));
  }
  const exa = await runExa(plan, input, statuses, signal, now);
  findings.push(...exa);
  return findings;
}

async function runExa(
  plan: readonly FootprintQueryPlanItem[],
  input: CandidateFootprintWorkerInput,
  statuses: Map<FootprintAdapterId, MutableStatus>,
  signal: AbortSignal,
  now: () => Date,
): Promise<readonly import('./adapters/footprintAdapter').FootprintFinding[]> {
  const people = plan.find(isPeoplePlanItem);
  const contexts = plan.filter(isContextPlanItem).map((item) => item.input);
  const fullName = people?.input.fullName ?? contexts[0]?.fullName;
  if (!fullName) return [];
  const photoUrl = people?.input.photoUrl ?? contexts.find((item) => item.photoUrl)?.photoUrl;
  const exaInput: ExaAdapterInput = {
    fullName,
    ...(photoUrl ? { photoUrl } : {}),
    employers: [...new Set(contexts.flatMap((item) => item.employers))].slice(0, 10),
    ...(contexts.find((item) => item.city)?.city
      ? { city: contexts.find((item) => item.city)?.city }
      : {}),
    profileUrls: [...new Set(plan.filter(isWaybackUrlPlanItem).map((item) => item.input.profileUrl))],
    searchPeople: Boolean(people),
    searchContext: contexts.length > 0,
  };
  return runSingleInputAdapter(
    input.adapters.exa, exaInput, 'exa', input, statuses, signal, now,
  );
}

function isPeoplePlanItem(item: FootprintQueryPlanItem): item is FootprintQueryPlanItem & {
  readonly input: { readonly mode: 'people'; readonly fullName: string; readonly photoUrl?: string };
} {
  return item.adapterId === 'exa' && 'mode' in item.input && item.input.mode === 'people';
}

function isContextPlanItem(item: FootprintQueryPlanItem): item is FootprintQueryPlanItem & {
  readonly input: { readonly mode: 'context'; readonly fullName: string; readonly employers: readonly string[]; readonly city?: string; readonly photoUrl?: string };
} {
  return item.adapterId === 'exa' && 'mode' in item.input && item.input.mode === 'context';
}

function isWaybackUrlPlanItem(item: FootprintQueryPlanItem): item is FootprintQueryPlanItem & {
  readonly input: { readonly profileUrl: string };
} {
  return item.adapterId === 'wayback' && 'profileUrl' in item.input;
}

function finalizedStatuses(
  statuses: Map<FootprintAdapterId, MutableStatus>,
  now: () => Date,
): readonly CandidateFootprintAdapterStatus[] {
  return ADAPTER_IDS.map((adapterId) => {
    const status = statuses.get(adapterId)!;
    const checkedAt = status.checkedAt ?? (status.state === 'not_run' ? undefined : now().toISOString());
    return {
      ...status,
      state: status.state === 'pending' ? 'checked' : status.state,
      ...(checkedAt ? { checkedAt } : {}),
    };
  });
}

function pendingStatuses(plan: readonly FootprintQueryPlanItem[]): readonly CandidateFootprintAdapterStatus[] {
  const selected = new Set(plan.map((item) => item.adapterId));
  return ADAPTER_IDS.map((adapterId) => ({
    adapterId,
    state: selected.has(adapterId) ? 'pending' : 'not_run',
    sourcesChecked: 0,
    findingsCount: 0,
  }));
}

async function executeAudit(
  input: CandidateFootprintWorkerInput,
  audit: CandidateFootprintAudit,
  previous: CandidateFootprintAudit | null,
  signal: AbortSignal,
): Promise<CandidateFootprintAudit> {
  const now = input.now ?? (() => new Date());
  const plan = selectPlanItems(input);
  if (!isAuthorized(input)) throw new FootprintConsentRequiredError();
  const statuses = makeStatuses(plan);
  const findings = [
    ...await runPresence('sherlock', plan, input, statuses, signal, now),
    ...await runPresence('maigret', plan, input, statuses, signal, now),
    ...await runExternalAdapters(plan, input, statuses, signal, now),
  ];
  if (signal.aborted || !isAuthorized(input)) throw new FootprintConsentRequiredError();
  return {
    ...audit,
    state: 'completed',
    adapterStatuses: finalizedStatuses(statuses, now),
    findings: mergeFootprintFindings(findings, previous?.findings ?? []),
    completedAt: now().toISOString(),
  };
}

function pendingAudit(
  input: CandidateFootprintWorkerInput,
  id: string,
): CandidateFootprintAudit {
  const plan = selectPlanItems(input);
  const now = input.now ?? (() => new Date());
  return {
    id,
    candidateId: input.candidateId,
    state: 'pending',
    selectedQueryIds: plan.map((item) => item.id),
    adapterStatuses: pendingStatuses(plan),
    findings: [],
    ownershipConfirmedAt: input.ownershipConfirmedAt,
    startedAt: now().toISOString(),
  };
}

function failedAudit(
  audit: CandidateFootprintAudit,
  now: () => Date,
): CandidateFootprintAudit {
  return {
    ...audit,
    state: 'failed',
    adapterStatuses: audit.adapterStatuses.map((status) => status.state === 'pending'
      ? { ...status, state: 'source_error', checkedAt: now().toISOString() }
      : status),
    completedAt: now().toISOString(),
  };
}

function finishRun(active: ActiveRun): void {
  activeRunsByAudit.delete(active.auditId);
  if (activeAuditByCandidate.get(active.candidateId) === active.auditId) {
    activeAuditByCandidate.delete(active.candidateId);
  }
}

export function startCandidateFootprintAudit(
  input: CandidateFootprintWorkerInput,
): CandidateFootprintAudit {
  if (!isAuthorized(input)) throw new FootprintConsentRequiredError();
  const existingAuditId = activeAuditByCandidate.get(input.candidateId);
  if (existingAuditId) {
    const current = input.repo.getLatestFootprintAudit(input.candidateId);
    if (current?.id === existingAuditId) return current;
  }
  selectPlanItems(input);
  const previous = input.repo.getLatestFootprintAudit(input.candidateId);
  const now = input.now ?? (() => new Date());
  const audit = pendingAudit(input, randomUUID());
  input.repo.saveFootprintAudit(audit);
  const active: ActiveRun = {
    auditId: audit.id,
    candidateId: input.candidateId,
    userId: input.userId,
    controller: new AbortController(),
    task: Promise.resolve(),
  };
  activeRunsByAudit.set(active.auditId, active);
  activeAuditByCandidate.set(active.candidateId, active.auditId);
  active.task = executeAudit(input, audit, previous, active.controller.signal)
    .then((completed) => {
      if (!active.controller.signal.aborted && isAuthorized(input)) {
        input.repo.saveFootprintAudit(completed);
      }
    })
    .catch(() => {
      if (!active.controller.signal.aborted && isAuthorized(input)) {
        input.repo.saveFootprintAudit(failedAudit(audit, now));
      }
    })
    .finally(() => finishRun(active));
  return audit;
}

export function cancelFootprintRunForUser(userId: string): void {
  for (const active of activeRunsByAudit.values()) {
    if (active.userId === userId) active.controller.abort();
  }
}

export function cancelFootprintRunForCandidate(candidateId: string): void {
  const auditId = activeAuditByCandidate.get(candidateId);
  if (auditId) activeRunsByAudit.get(auditId)?.controller.abort();
}

export function isFootprintRunActive(auditId: string): boolean {
  return activeRunsByAudit.has(auditId);
}

export async function waitForFootprintRun(auditId: string): Promise<void> {
  await activeRunsByAudit.get(auditId)?.task;
}
