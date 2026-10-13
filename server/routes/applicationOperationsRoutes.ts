import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { APPLICATION_STAGES, deliveryState, type ApplicationStage } from '../../shared/applicationStage';
import { candidateCompanyKey } from '../domain/candidateCompanies';
import type { ApplicationTrackerMethods } from '../data/sqliteCandidateStoreApplicationMethods';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, sendError, withDeps } from './helpers';
import { isoDateField } from './isoDateField';
import { timezoneOffsetSchema } from './timezoneQuery';

const stageListSchema = repeatedValuesSchema(z.enum(APPLICATION_STAGES));
const channelListSchema = repeatedValuesSchema(z.string().trim().min(1).max(120));

const applicationFilterObjectSchema = z.object({
  stage: stageListSchema.default([]),
  channel: channelListSchema.default([]),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

const applicationFilterSchema = applicationFilterObjectSchema.superRefine((filters, context) => {
  if (filters.from && filters.to && filters.from > filters.to) {
    context.addIssue({ code: 'custom', message: 'Период задан в обратном порядке', path: ['to'] });
  }
});

export const listApplicationsQuerySchema = applicationFilterObjectSchema.extend({
  sort: z.enum(['date', 'company', 'stage']).default('date'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().positive().max(100).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
  tz: timezoneOffsetSchema,
}).superRefine((filters, context) => {
  if (filters.from && filters.to && filters.from > filters.to) {
    context.addIssue({ code: 'custom', message: 'Период задан в обратном порядке', path: ['to'] });
  }
});

const bulkActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('close') }),
  z.object({ type: z.literal('set_stage'), stage: z.enum(APPLICATION_STAGES) }),
  z.object({ type: z.literal('retry') }),
]);

const bulkFilterBodySchema = applicationFilterSchema;
const bulkPreviewSchema = z.object({ filters: bulkFilterBodySchema, action: bulkActionSchema });
const bulkOperationSchema = bulkPreviewSchema.extend({
  operationId: z.string().trim().min(1).max(120),
  confirmCount: z.number().int().nonnegative().max(10_000),
});

const applicationLabelSchema = z.object({
  name: z.string().trim().min(1).max(36).refine((name) => name.replace(/\s+/gu, ' ').length > 0),
});

const companyInputSchema = z.object({
  companyName: z.string().trim().min(1).max(300),
  nextStep: z.string().trim().min(1).max(180).optional(),
  nextStepDueAt: isoDateField.nullable().optional(),
});
const companyWantActionSchema = z.enum(['add', 'set_next_step', 'remove']);
const companyWantBaseSchema = z.object({
  operationId: z.string().trim().min(1).max(120),
  action: companyWantActionSchema,
  companies: z.array(companyInputSchema).min(1).max(100),
  confirmCount: z.number().int().nonnegative().max(100),
});
const companyWantBulkSchema = companyWantBaseSchema.superRefine((input, context) => {
  if (input.action === 'set_next_step' && input.companies.some((company) => !company.nextStep)) {
    context.addIssue({ code: 'custom', message: 'Для следующего шага нужен текст', path: ['companies'] });
  }
});
const companyWantPreviewSchema = companyWantBaseSchema
  .omit({ operationId: true, confirmCount: true })
  .superRefine((input, context) => {
    if (input.action === 'set_next_step' && input.companies.some((company) => !company.nextStep)) {
      context.addIssue({ code: 'custom', message: 'Для следующего шага нужен текст', path: ['companies'] });
    }
  });

type ApplicationFilters = z.infer<typeof applicationFilterSchema>;
type ListQuery = z.infer<typeof listApplicationsQuerySchema>;
type ApplicationOperationStore = Pick<
  ApplicationTrackerMethods,
  | 'listApplicationLabels'
  | 'createApplicationLabel'
  | 'listApplicationLabelAssignments'
  | 'assignApplicationLabel'
  | 'removeApplicationLabel'
  | 'runApplicationOperation'
  | 'bulkQueueApplicationRetries'
  | 'bulkChangeApplicationStages'
>;
type ApplicationRow = {
  id: string;
  stage: string;
  createdAt: string;
  updatedAt?: string;
  vacancy?: { company?: string | null; source?: string | null } | null;
  deliveryReceipt?: { kind: string; value: string } | null;
  version?: number;
  labels?: readonly unknown[];
};
type ApplicationWithLabels<T extends ApplicationRow> = T & {
  labels: ReturnType<ApplicationOperationStore['listApplicationLabels']>;
};

class BulkConfirmationError extends Error {
  constructor(readonly affectedCount: number) {
    super('Количество записей изменилось после предпросмотра');
    this.name = 'BulkConfirmationError';
  }
}

export function filterApplicationRows<T extends ApplicationRow>(
  rows: readonly T[],
  filters: Pick<ListQuery, 'stage' | 'channel' | 'from' | 'to'> & Pick<ListQuery, 'sort' | 'direction'>,
): T[] {
  const filtered = rows.filter((row) => matchesApplicationFilters(row, filters));
  return filtered.sort((left, right) => compareApplicationRows(left, right, filters));
}

function repeatedValuesSchema<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(
    (value) => value === undefined ? [] : Array.isArray(value) ? value : [value],
    z.array(item).max(20),
  );
}

function matchesApplicationFilters(
  row: ApplicationRow,
  filters: Pick<ApplicationFilters, 'stage' | 'channel' | 'from' | 'to'>,
): boolean {
  if (filters.stage.length && !filters.stage.includes(row.stage as ApplicationStage)) return false;
  if (filters.channel.length && !filters.channel.includes(row.vacancy?.source ?? '')) return false;
  const date = row.createdAt.slice(0, 10);
  if (filters.from && date < filters.from) return false;
  if (filters.to && date > filters.to) return false;
  return true;
}

function compareApplicationRows(
  left: ApplicationRow,
  right: ApplicationRow,
  query: Pick<ListQuery, 'sort' | 'direction'>,
): number {
  const order = query.sort === 'company'
    ? (left.vacancy?.company ?? '').localeCompare(right.vacancy?.company ?? '', 'ru')
    : query.sort === 'stage'
      ? left.stage.localeCompare(right.stage, 'ru')
      : left.createdAt.localeCompare(right.createdAt);
  return (query.direction === 'asc' ? order : -order) || left.id.localeCompare(right.id);
}

function applicationStore(candidateStore: RouteDeps['candidateStore']): RouteDeps['candidateStore'] & ApplicationOperationStore {
  return candidateStore as RouteDeps['candidateStore'] & ApplicationOperationStore;
}

function listApplicationsWithLabels(
  deps: RouteDeps,
  candidateId: string,
  timezoneOffsetMinutes?: number,
): ApplicationWithLabels<ApplicationRow>[] {
  const store = applicationStore(deps.candidateStore);
  const rows = deps.candidateStore.listApplications(candidateId, {
    timezoneOffsetMinutes,
    archiveStaleDays: deps.config.applicationArchiveStaleDays,
  }) as ApplicationRow[];
  const labelsById = new Map(store.listApplicationLabels(candidateId).map((label) => [label.id, label]));
  const labelsByApplication = new Map<string, ReturnType<ApplicationOperationStore['listApplicationLabels']>>();
  for (const assignment of store.listApplicationLabelAssignments(candidateId)) {
    const label = labelsById.get(assignment.labelId);
    if (!label) continue;
    const labels = labelsByApplication.get(assignment.applicationId) ?? [];
    labels.push(label);
    labelsByApplication.set(assignment.applicationId, labels);
  }
  return rows.map((row) => ({ ...row, labels: labelsByApplication.get(row.id) ?? [] }));
}

async function handleListApplications(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
  if (!candidate) return undefined;
  const query = listApplicationsQuerySchema.parse(request.query ?? {});
  const rows = listApplicationsWithLabels(deps, candidate.id, query.tz);
  const stageCounts = countApplicationStages(filterApplicationRows(rows, { ...query, stage: [] }));
  const filtered = filterApplicationRows(rows, query);
  return {
    data: filtered.slice(query.offset, query.offset + query.limit),
    meta: {
      requestId: request.id,
      total: filtered.length,
      offset: query.offset,
      limit: query.limit,
      stageCounts,
    },
  };
}

function countApplicationStages(rows: readonly ApplicationRow[]): Record<ApplicationStage, number> {
  const counts = Object.fromEntries(APPLICATION_STAGES.map((stage) => [stage, 0])) as Record<ApplicationStage, number>;
  for (const row of rows) {
    if (APPLICATION_STAGES.includes(row.stage as ApplicationStage)) counts[row.stage as ApplicationStage] += 1;
  }
  return counts;
}

function bulkTargets(deps: RouteDeps, candidateId: string, filters: ApplicationFilters, action: z.infer<typeof bulkActionSchema>) {
  const rows = filterApplicationRows(listApplicationsWithLabels(deps, candidateId), {
    ...filters,
    sort: 'date',
    direction: 'desc',
  });
  if (action.type === 'retry') {
    return rows.filter((row) => deliveryState(row.stage as ApplicationStage, row.deliveryReceipt as never) === 'failed');
  }
  const targetStage = action.type === 'close' ? 'archived' : action.stage;
  return rows.filter((row) => row.stage !== targetStage);
}

function safeCandidate(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply, mutate: boolean) {
  if (mutate && !hasSafeMutationOrigin(request, deps.config)) {
    csrfError(request, reply);
    return null;
  }
  return authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
}

function applicationMutationError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof Error && error.name === 'ApplicationOperationConflictError') {
    return sendError(reply, request, 409, 'idempotency_key_reused', error.message, false);
  }
  if (error instanceof BulkConfirmationError) {
    return sendError(reply, request, 409, 'bulk_confirmation_count_changed', error.message, false, undefined, {
      affectedCount: error.affectedCount,
    });
  }
  throw error;
}

async function handleBulkPreview(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = safeCandidate(deps, request, reply, true);
  if (!candidate) return undefined;
  const body = bulkPreviewSchema.parse(request.body);
  return {
    data: { affectedCount: bulkTargets(deps, candidate.id, body.filters, body.action).length, action: body.action },
    meta: { requestId: request.id },
  };
}

async function handleBulkApplications(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = safeCandidate(deps, request, reply, true);
  if (!candidate) return undefined;
  const body = bulkOperationSchema.parse(request.body);
  const store = applicationStore(deps.candidateStore);
  try {
    const operation = store.runApplicationOperation(
      candidate.id,
      body.operationId,
      digestRequest({ filters: body.filters, action: body.action, confirmCount: body.confirmCount }),
      'applications_bulk',
      () => executeApplicationBulk(deps, store, candidate.id, body),
    );
    return { data: { ...operation.result, replayed: operation.replayed }, meta: { requestId: request.id } };
  } catch (error) {
    return applicationMutationError(error, request, reply);
  }
}

function executeApplicationBulk(
  deps: RouteDeps,
  store: ApplicationOperationStore,
  candidateId: string,
  body: z.infer<typeof bulkOperationSchema>,
): Record<string, unknown> {
  const targets = bulkTargets(deps, candidateId, body.filters, body.action);
  if (targets.length !== body.confirmCount) throw new BulkConfirmationError(targets.length);
  if (body.action.type === 'retry') return prepareRetries(store, candidateId, body.operationId, targets);
  const stage = body.action.type === 'close' ? 'archived' : body.action.stage;
  return closeOrChangeApplications(store, candidateId, stage, targets);
}

function prepareRetries(
  store: ApplicationOperationStore,
  candidateId: string,
  operationId: string,
  targets: readonly ApplicationRow[],
): Record<string, unknown> {
  const requestedAt = new Date().toISOString();
  const preparedCount = store.bulkQueueApplicationRetries(
    candidateId,
    targets.map(({ id }) => ({ id })),
    operationId,
    requestedAt,
  );
  return { state: 'prepared', preparedCount, sentCount: 0, changedCount: preparedCount };
}

function closeOrChangeApplications(
  store: ApplicationOperationStore,
  candidateId: string,
  stage: ApplicationStage,
  targets: readonly ApplicationRow[],
): Record<string, unknown> {
  const occurredAt = new Date().toISOString();
  const stageTargets = targets.map((application) => ({
    id: application.id,
    stage: application.stage as ApplicationStage,
    version: application.version ?? -1,
  }));
  const changedCount = store.bulkChangeApplicationStages(candidateId, stageTargets, stage, occurredAt);
  return { state: 'completed', changedCount, stage };
}

function digestRequest(request: unknown): string {
  return createHash('sha256').update(stableJson(request)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function handleListApplicationLabels(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = safeCandidate(deps, request, reply, false);
  if (!candidate) return undefined;
  return { data: applicationStore(deps.candidateStore).listApplicationLabels(candidate.id), meta: { requestId: request.id } };
}

async function handleCreateApplicationLabel(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = safeCandidate(deps, request, reply, true);
  if (!candidate) return undefined;
  const { name } = applicationLabelSchema.parse(request.body);
  const store = applicationStore(deps.candidateStore);
  const normalized = name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und');
  const exists = store.listApplicationLabels(candidate.id).some((label) =>
    label.name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und') === normalized,
  );
  const label = store.createApplicationLabel(candidate.id, name);
  reply.code(exists ? 200 : 201);
  return { data: label, meta: { requestId: request.id } };
}

async function handleAssignApplicationLabel(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = safeCandidate(deps, request, reply, true);
  if (!candidate) return undefined;
  const { id, labelId } = request.params as { id: string; labelId: string };
  const result = applicationStore(deps.candidateStore).assignApplicationLabel(candidate.id, id, labelId);
  if (!result.applicationExists) return sendError(reply, request, 404, 'application_not_found', 'Отклик не найден.', false);
  if (!result.label) return sendError(reply, request, 404, 'application_label_not_found', 'Метка не найдена.', false);
  return { data: { changed: result.changed, label: result.label }, meta: { requestId: request.id } };
}

async function handleRemoveApplicationLabel(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = safeCandidate(deps, request, reply, true);
  if (!candidate) return undefined;
  const { id, labelId } = request.params as { id: string; labelId: string };
  const result = applicationStore(deps.candidateStore).removeApplicationLabel(candidate.id, id, labelId);
  if (!result.applicationExists) return sendError(reply, request, 404, 'application_not_found', 'Отклик не найден.', false);
  if (!result.labelExists) return sendError(reply, request, 404, 'application_label_not_found', 'Метка не найдена.', false);
  return { data: { changed: result.changed }, meta: { requestId: request.id } };
}

function companyWantRepository(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (deps.candidateCompanyWantsRepo) return deps.candidateCompanyWantsRepo;
  sendError(reply, request, 503, 'company_wants_unavailable', 'Список компаний временно недоступен.', true);
  return null;
}

async function handleListCompanyWants(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = safeCandidate(deps, request, reply, false);
  if (!candidate) return undefined;
  const repository = companyWantRepository(deps, request, reply);
  return repository ? { data: repository.list(candidate.id), meta: { requestId: request.id } } : undefined;
}

async function handleCompanyWantPreview(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = safeCandidate(deps, request, reply, true);
  if (!candidate) return undefined;
  const input = companyWantPreviewSchema.parse(request.body);
  const repository = companyWantRepository(deps, request, reply);
  if (!repository) return undefined;
  return { data: { affectedCount: companyWantTargets(repository.list(candidate.id), input).length }, meta: { requestId: request.id } };
}

async function handleCompanyWantBulk(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = safeCandidate(deps, request, reply, true);
  if (!candidate) return undefined;
  const body = companyWantBulkSchema.parse(request.body);
  const repository = companyWantRepository(deps, request, reply);
  if (!repository) return undefined;
  const store = applicationStore(deps.candidateStore);
  try {
    const operation = store.runApplicationOperation(
      candidate.id,
      body.operationId,
      digestRequest({ action: body.action, companies: body.companies, confirmCount: body.confirmCount }),
      'company_wants_bulk',
      () => executeCompanyWantBulk(repository, candidate.id, body),
    );
    return { data: { ...operation.result, replayed: operation.replayed }, meta: { requestId: request.id } };
  } catch (error) {
    return applicationMutationError(error, request, reply);
  }
}

function uniqueCompanies<T extends { companyName: string }>(companies: readonly T[]): T[] {
  const seen = new Set<string>();
  return companies.filter((company) => {
    const key = candidateCompanyKey(company.companyName);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function companyWantTargets(
  current: readonly { companyKey: string }[],
  input: Pick<z.infer<typeof companyWantBulkSchema>, 'action' | 'companies'>,
) {
  const currentKeys = new Set(current.map((want) => want.companyKey));
  return uniqueCompanies(input.companies).filter((company) => {
    const exists = currentKeys.has(candidateCompanyKey(company.companyName));
    return input.action === 'add' ? !exists : exists;
  });
}

function executeCompanyWantBulk(
  repository: NonNullable<RouteDeps['candidateCompanyWantsRepo']>,
  candidateId: string,
  body: z.infer<typeof companyWantBulkSchema>,
): Record<string, unknown> {
  const targets = companyWantTargets(repository.list(candidateId), body);
  if (targets.length !== body.confirmCount) throw new BulkConfirmationError(targets.length);
  const now = new Date().toISOString();
  for (const company of targets) applyCompanyWantAction(repository, candidateId, company, body.action, now);
  return { state: 'completed', changedCount: targets.length };
}

function applyCompanyWantAction(
  repository: NonNullable<RouteDeps['candidateCompanyWantsRepo']>,
  candidateId: string,
  company: z.infer<typeof companyInputSchema>,
  action: z.infer<typeof companyWantActionSchema>,
  now: string,
): void {
  const key = candidateCompanyKey(company.companyName);
  if (action === 'add') repository.setWanted(candidateId, key, company.companyName, now);
  if (action === 'set_next_step') {
    repository.setNextStep(candidateId, key, company.nextStep ?? null, company.nextStepDueAt ?? null, now);
  }
  if (action === 'remove') repository.remove(candidateId, key);
}

export function registerApplicationOperationsRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/applications', withDeps(deps, handleListApplications));
  app.post('/api/v1/candidate/application-labels', withDeps(deps, handleCreateApplicationLabel));
  app.get('/api/v1/candidate/application-labels', withDeps(deps, handleListApplicationLabels));
  app.put('/api/v1/candidate/applications/:id/labels/:labelId', withDeps(deps, handleAssignApplicationLabel));
  app.delete('/api/v1/candidate/applications/:id/labels/:labelId', withDeps(deps, handleRemoveApplicationLabel));
  app.post('/api/v1/candidate/applications/bulk/preview', withDeps(deps, handleBulkPreview));
  app.post('/api/v1/candidate/applications/bulk', withDeps(deps, handleBulkApplications));
  app.get('/api/v1/candidate/applications/company-wants', withDeps(deps, handleListCompanyWants));
  app.post('/api/v1/candidate/applications/company-wants/bulk/preview', withDeps(deps, handleCompanyWantPreview));
  app.post('/api/v1/candidate/applications/company-wants/bulk', withDeps(deps, handleCompanyWantBulk));
}
