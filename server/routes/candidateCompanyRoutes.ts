import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CandidateCompanyRecruiter } from '../../shared/candidateCompany';
import type { RecruiterContact } from '../../shared/recruiterContact';
import {
  buildCandidateCompanyRows,
  candidateCompanyKey,
  filterCandidateCompanyRows,
  sortCandidateCompanyRows,
  type CandidateCompanyVacancyInput,
} from '../domain/candidateCompanies';
import { finishMatchedVacancies } from './matchedVacancyRoutes';
import { readCampaign } from './campaignContext';
import { readMatchProfile, readMatchedSnapshot } from '../vacancies/matchedPoolContext';
import { readTargetLevel } from './vacancyRoleContext';
import {
  listCandidateConnectionViews,
  deriveImportedFactSources,
} from '../connectors/nativeSourceConnection';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

const pageQuerySchema = z.object({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(20).default(20),
  sort: z.enum(['default', 'contacts', 'alphabetical']).default('default'),
  filter: z.enum(['all', 'want', 'contacts', 'recruiter']).default('all'),
  search: z.string().trim().max(120).default(''),
});

const detailQuerySchema = z.object({
  vacancyOffset: z.coerce.number().int().nonnegative().default(0),
  vacancyLimit: z.coerce.number().int().positive().max(20).default(20),
});

const nextStepSchema = z.object({
  text: z.string().trim().min(1).max(180),
  dueAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .nullable()
    .optional(),
});

interface CandidateCompanyContext {
  readonly rows: ReturnType<typeof buildCandidateCompanyRows>;
  readonly vacancies: readonly CandidateCompanyVacancyInput[];
  readonly linkedin: {
    readonly status: 'connected' | 'profile-imported' | 'disconnected';
    readonly importedAt: string | null;
    readonly contactsImported: false;
  };
  readonly searchConsentGranted: boolean;
}

function safeHttpsUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function publicSourceLabel(name?: string, sourceId?: string): string {
  const value = (name ?? '').trim();
  if (/\b(pool|account|node|proxy|crawler)\b/iu.test(value)) {
    return /linkedin/iu.test(value) || sourceId === 'linkedin' ? 'LinkedIn' : 'Публичный источник';
  }
  if (value) return value;
  return sourceId === 'linkedin' ? 'LinkedIn' : sourceId === 'hh' ? 'hh.ru' : 'Источник неизвестен';
}

function projectVacancyItems(
  items: Awaited<ReturnType<typeof readCurrentMatched>>,
): CandidateCompanyVacancyInput[] {
  return items.flatMap(({ cluster }) => {
    const companyName = cluster.canonicalCompany.trim();
    if (!companyName) return [];
    const source = cluster.sources[0];
    return [
      {
        id: cluster.id,
        companyName,
        location: cluster.canonicalLocation ?? null,
        industry: cluster.companyFeatures?.industry ?? null,
        sourceName: publicSourceLabel(source?.sourceName, source?.sourceId),
        sourceDate: source?.observedAt || cluster.lastSeenAt,
        href: safeHttpsUrl(cluster.primaryUrl),
        title: cluster.canonicalTitle,
      },
    ];
  });
}

function safeRecruiter(contact: RecruiterContact, companyKey: string): CandidateCompanyRecruiter {
  const isVacancySource = contact.sourceType === 'vacancy_text';
  const profileUrl = contact.linkedinUrl ?? contact.sourceReceipt?.sourceUrl ?? '';
  const fromLinkedIn = /linkedin\.com/iu.test(profileUrl);
  const sourceLabel = isVacancySource
    ? 'Объявление вакансии'
    : fromLinkedIn
      ? 'Публичный профиль LinkedIn'
      : 'Публичный профиль';
  return {
    id: contact.id,
    companyKey,
    vacancyId: contact.vacancyId,
    fullName: contact.fullName,
    roleTitle: contact.roleTitle,
    email: contact.email,
    emailStatus: contact.emailStatus,
    phone: contact.phone,
    telegram: contact.telegram,
    whatsapp: contact.whatsapp,
    linkedinUrl: contact.linkedinUrl,
    githubUrl: contact.githubUrl,
    twitterUrl: contact.twitterUrl,
    source: isVacancySource ? 'vacancy' : 'public-profile',
    sourceLabel,
    sourceDate: contact.sourceReceipt?.observedAt ?? contact.updatedAt,
    isHypothesis: !isVacancySource || contact.emailStatus === 'hypothesis',
  };
}

async function readCurrentMatched(deps: RouteDeps, candidateId: string) {
  const { confirmedSkills } = readMatchProfile(deps.candidateStore, candidateId);
  const campaign = readCampaign(deps.candidateStore, candidateId);
  const roles = [...campaign.roles.value];
  if (confirmedSkills.length === 0 && roles.length === 0) return [];
  const level = readTargetLevel(deps.candidateStore, candidateId, roles);
  const snapshot = await readMatchedSnapshot(
    deps.multiSourceEngine,
    candidateId,
    confirmedSkills,
    roles,
    level,
  );
  return finishMatchedVacancies(snapshot, roles, campaign, deps.candidateStore, candidateId);
}

function linkedinStatus(deps: RouteDeps, candidateId: string): CandidateCompanyContext['linkedin'] {
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const imported = deriveImportedFactSources(snapshot?.messages ?? [], snapshot?.memory ?? []);
  const views = listCandidateConnectionViews(
    deps.candidateStore.listNativeSourceConnections(candidateId),
    imported,
  );
  const linkedin = views.find((connection) => connection.platform === 'linkedin');
  if (linkedin?.status === 'connected') {
    return { status: 'connected', importedAt: linkedin.lastImportedAt, contactsImported: false };
  }
  if (linkedin?.status === 'imported') {
    return { status: 'profile-imported', importedAt: linkedin.importedAt, contactsImported: false };
  }
  return { status: 'disconnected', importedAt: null, contactsImported: false };
}

async function companyContext(
  deps: RouteDeps,
  candidateId: string,
): Promise<CandidateCompanyContext> {
  const matches = await readCurrentMatched(deps, candidateId);
  const vacancies = projectVacancyItems(matches);
  const vacancyCompanyKeys = new Map(
    vacancies.map((vacancy) => [vacancy.id, candidateCompanyKey(vacancy.companyName)]),
  );
  const recruiters = (deps.recruiterContactsRepo?.listContactsByCandidateId(candidateId) ?? [])
    .filter((contact) => vacancyCompanyKeys.has(contact.vacancyId))
    .map((contact) => safeRecruiter(contact, vacancyCompanyKeys.get(contact.vacancyId)!));
  const jobs = (deps.recruiterContactsRepo?.listJobsByCandidateId(candidateId) ?? [])
    .filter((job) => vacancyCompanyKeys.has(job.vacancyId))
    .map((job) => ({ vacancyId: job.vacancyId, status: job.status }));
  const rows = buildCandidateCompanyRows({
    vacancies,
    wants: deps.candidateCompanyWantsRepo?.list(candidateId) ?? [],
    recruiters,
    jobs,
  });
  return {
    rows,
    vacancies,
    linkedin: linkedinStatus(deps, candidateId),
    searchConsentGranted: deps.searchConsentRepo?.get(candidateId).granted ?? false,
  };
}

function filterCounts(rows: CandidateCompanyContext['rows']) {
  const knownContacts = rows.filter((row) => row.contactsCount !== null);
  return {
    all: rows.length,
    want: rows.filter((row) => row.want).length,
    contacts:
      knownContacts.length > 0 ? rows.filter((row) => (row.contactsCount ?? 0) > 0).length : null,
    recruiter: rows.filter((row) => row.hasRecruiter).length,
  };
}

function candidateNotFound(reply: FastifyReply, request: FastifyRequest): FastifyReply {
  return sendError(
    reply,
    request,
    404,
    'company_not_in_selection',
    'Компания не найдена в текущей подборке.',
    false,
  );
}

function wantRepository(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (deps.candidateCompanyWantsRepo) return deps.candidateCompanyWantsRepo;
  sendError(
    reply,
    request,
    503,
    'company_wants_unavailable',
    'Список компаний временно недоступен.',
    true,
  );
  return null;
}

async function handleListCompanies(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  if (!wantRepository(deps, request, reply)) return undefined;
  const parsed = pageQuerySchema.safeParse(request.query);
  if (!parsed.success)
    return sendError(
      reply,
      request,
      400,
      'invalid_company_query',
      'Проверьте параметры списка компаний.',
      false,
    );
  const query = parsed.data;
  const context = await companyContext(deps, candidate.id);
  const filtered = filterCandidateCompanyRows(context.rows, query.filter, query.search);
  const sorted = sortCandidateCompanyRows(filtered, query.sort);
  const items = sorted.slice(query.offset, query.offset + query.limit);
  const nextOffset =
    query.offset + items.length < sorted.length ? query.offset + items.length : null;
  return {
    data: {
      items,
      total: sorted.length,
      offset: query.offset,
      limit: query.limit,
      sort: query.sort,
      filter: query.filter,
      filterCounts: filterCounts(context.rows),
      linkedin: context.linkedin,
      searchConsentGranted: context.searchConsentGranted,
    },
    meta: { requestId: request.id, total: sorted.length, offset: query.offset, nextOffset },
  };
}

async function handleGetCompany(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  if (!wantRepository(deps, request, reply)) return undefined;
  const companyKey = (request.params as { companyKey: string }).companyKey;
  if (!/^[a-f0-9]{24}$/u.test(companyKey)) return candidateNotFound(reply, request);
  const parsed = detailQuerySchema.safeParse(request.query);
  if (!parsed.success)
    return sendError(
      reply,
      request,
      400,
      'invalid_company_query',
      'Проверьте параметры вакансий компании.',
      false,
    );
  const context = await companyContext(deps, candidate.id);
  const company = context.rows.find((row) => row.key === companyKey);
  if (!company) return candidateNotFound(reply, request);
  const companyVacancies = context.vacancies.filter(
    (vacancy) => candidateCompanyKey(vacancy.companyName) === companyKey,
  );
  const { vacancyOffset, vacancyLimit } = parsed.data;
  const vacancies = companyVacancies.slice(vacancyOffset, vacancyOffset + vacancyLimit);
  const nextOffset =
    vacancyOffset + vacancies.length < companyVacancies.length
      ? vacancyOffset + vacancies.length
      : null;
  return {
    data: {
      company,
      vacancies,
      totalVacancies: companyVacancies.length,
      vacancyOffset,
      nextOffset,
    },
    meta: {
      requestId: request.id,
      total: companyVacancies.length,
      offset: vacancyOffset,
      nextOffset,
    },
  };
}

async function handleSetWant(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const repo = wantRepository(deps, request, reply);
  if (!repo) return undefined;
  const companyKey = (request.params as { companyKey: string }).companyKey;
  const existing = repo.get(candidate.id, companyKey);
  let companyName = existing?.companyName;
  if (!companyName) {
    const context = await companyContext(deps, candidate.id);
    companyName = context.rows.find((row) => row.key === companyKey)?.name;
  }
  if (!companyName) return candidateNotFound(reply, request);
  const want = repo.setWanted(candidate.id, companyKey, companyName);
  return {
    data: {
      want: true,
      nextStep: want.nextStep ? { text: want.nextStep, dueAt: want.nextStepDueAt } : null,
    },
    meta: { requestId: request.id },
  };
}

async function handleRemoveWant(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const repo = wantRepository(deps, request, reply);
  if (!repo) return undefined;
  const companyKey = (request.params as { companyKey: string }).companyKey;
  const removed = repo.remove(candidate.id, companyKey);
  return { data: { want: false, removed }, meta: { requestId: request.id } };
}

async function handleSetNextStep(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const repo = wantRepository(deps, request, reply);
  if (!repo) return undefined;
  const companyKey = (request.params as { companyKey: string }).companyKey;
  const parsed = nextStepSchema.safeParse(request.body ?? {});
  if (!parsed.success)
    return sendError(
      reply,
      request,
      422,
      'invalid_company_next_step',
      'Укажите следующий шаг и проверьте дату.',
      false,
    );
  if (!repo.get(candidate.id, companyKey)) {
    return sendError(
      reply,
      request,
      409,
      'company_want_required',
      'Сначала добавьте компанию в «Хочу».',
      false,
    );
  }
  const nextStep = repo.setNextStep(
    candidate.id,
    companyKey,
    parsed.data.text,
    parsed.data.dueAt ?? null,
  );
  return {
    data: {
      nextStep: nextStep?.nextStep
        ? { text: nextStep.nextStep, dueAt: nextStep.nextStepDueAt }
        : null,
    },
    meta: { requestId: request.id },
  };
}

function recruiterQueueStatus(
  statuses: readonly string[],
): 'queued' | 'running' | 'ready' | 'failed' {
  if (statuses.includes('ready')) return 'ready';
  if (statuses.includes('running')) return 'running';
  if (statuses.includes('queued')) return 'queued';
  return 'failed';
}

function canSearchRecruiters(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidateId: string,
): boolean {
  if (!deps.searchConsentRepo?.get(candidateId).granted) {
    sendError(
      reply,
      request,
      403,
      'search_consent_required',
      'Нужно включить режим «Вы в поиске», чтобы искать контакты рекрутёров.',
      false,
    );
    return false;
  }
  if (!deps.recruiterContactsRepo) {
    sendError(
      reply,
      request,
      503,
      'recruiter_intelligence_unavailable',
      'Поиск рекрутёра временно недоступен.',
      true,
    );
    return false;
  }
  return true;
}

async function matchedCompanyVacancyIds(
  deps: RouteDeps,
  candidateId: string,
  companyKey: string,
): Promise<string[]> {
  const context = await companyContext(deps, candidateId);
  return context.vacancies
    .filter((vacancy) => candidateCompanyKey(vacancy.companyName) === companyKey)
    .map((vacancy) => vacancy.id)
    .slice(0, 3);
}

function enqueueCompanyRecruiterJobs(
  repo: NonNullable<RouteDeps['recruiterContactsRepo']>,
  candidateId: string,
  vacancyIds: readonly string[],
) {
  return vacancyIds.map((vacancyId) => {
    const current = repo.getJob(candidateId, vacancyId);
    return current && current.status !== 'failed'
      ? current
      : repo.enqueueJob(candidateId, vacancyId);
  });
}

async function handleSearchRecruiter(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const companyKey = (request.params as { companyKey: string }).companyKey;
  if (!/^[a-f0-9]{24}$/u.test(companyKey)) return candidateNotFound(reply, request);
  if (!canSearchRecruiters(deps, request, reply, candidate.id)) return undefined;
  const vacancyIds = await matchedCompanyVacancyIds(deps, candidate.id, companyKey);
  if (vacancyIds.length === 0) {
    return sendError(
      reply,
      request,
      409,
      'company_has_no_matched_vacancies',
      'В текущей подборке нет вакансии компании, по которой можно искать рекрутёра.',
      false,
    );
  }
  const jobs = enqueueCompanyRecruiterJobs(deps.recruiterContactsRepo!, candidate.id, vacancyIds);
  const status = recruiterQueueStatus(jobs.map((job) => job.status));
  request.log.info(
    { event: 'company-recruiter-search-requested', vacancyCount: jobs.length },
    'candidate-company-recruiter-search',
  );
  return reply.code(status === 'ready' ? 200 : 202).send({
    data: { searchStatus: status },
    meta: { requestId: request.id },
  });
}

export function registerCandidateCompanyRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    '/api/v1/candidate/companies',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    withDeps(deps, handleListCompanies),
  );
  app.get('/api/v1/candidate/companies/:companyKey', withDeps(deps, handleGetCompany));
  app.put(
    '/api/v1/candidate/companies/:companyKey/want',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    withDeps(deps, handleSetWant),
  );
  app.delete('/api/v1/candidate/companies/:companyKey/want', withDeps(deps, handleRemoveWant));
  app.put('/api/v1/candidate/companies/:companyKey/next-step', withDeps(deps, handleSetNextStep));
  app.post(
    '/api/v1/candidate/companies/:companyKey/recruiter-search',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    withDeps(deps, handleSearchRecruiter),
  );
}
