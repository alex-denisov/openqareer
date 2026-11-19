import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { B640CompanyCard, B640CompanyPage } from '../../shared/b640Companies';
import type { ApplicationStage } from '../../shared/applicationStage';
import {
  candidateCompanyKey,
  filterCandidateCompanyRows,
  sortCandidateCompanyRows,
} from '../domain/candidateCompanies';
import { getCompanyRegistry } from '../domain/companyRegistry';
import { trim } from '../vacancies/matchedVacancyPage';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { addStoredVacancyLevels } from '../vacancies/storedVacancyLevels';
import { readB640PoolRows } from './b640MatchedVacancyRoutes';
import { citiesOf, filterByPlace, findCompanyRow, withRelocation } from './b640CompanyModel';
import { companyMissing, registerB640CompanyPeopleRoute } from './b640CompanyPeople';
import { readB640ListContext, sessionCandidate } from './b640VacancyContext';
import { requireCabinetB640 } from './cabinetB640Flag';
import { companyContext, filterCounts, pageQuerySchema } from './candidateCompanyRoutes';
import type { RouteDeps } from './deps';
import { candidatePlan, sendError, withDeps } from './helpers';
import { selectionFitLimit } from './fitSelectionSweep';
import { withShownPageFitViews } from './matchedVacancyFit';
import { startShownPageFit, withMarketSalary } from './matchedVacancyRoutes';
import { withRequestScopedCandidateReads } from './requestScopedCandidateReads';

const listSchema = pageQuerySchema.extend({
  relocation: z.literal('1').optional(),
  city: z.string().trim().min(1).max(120).optional(),
});

const cardSchema = z.object({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(20).default(20),
});

const OTHER_LIMIT = 20;
const findCompany = (name: string) => getCompanyRegistry().findByName(name);

function badQuery(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendError(
    reply,
    request,
    400,
    'invalid_company_query',
    'Проверьте параметры списка компаний.',
    false,
  );
}

async function getCompanies(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  const parsed = listSchema.safeParse(request.query);
  if (!parsed.success) return badQuery(request, reply);
  const query = parsed.data;
  const context = await companyContext(deps, candidate.id);
  const all = withRelocation(context.rows, findCompany);
  const relocation = query.relocation === '1';
  const placed = filterByPlace(all, { relocation, city: query.city ?? null });
  const sorted = sortCandidateCompanyRows(
    filterCandidateCompanyRows(placed, query.filter, query.search),
    query.sort,
  );
  const items = sorted.slice(query.offset, query.offset + query.limit);
  const data: B640CompanyPage = {
    items,
    total: sorted.length,
    offset: query.offset,
    limit: query.limit,
    sort: query.sort,
    filter: query.filter,
    filterCounts: {
      ...filterCounts(placed),
      relocation: all.filter((row) => row.relocation).length,
    },
    linkedin: context.linkedin,
    searchConsentGranted: context.searchConsentGranted,
    relocation,
    city: query.city ?? null,
    cities: citiesOf(filterByPlace(all, { relocation, city: null })),
  };
  const nextOffset =
    query.offset + items.length < sorted.length ? query.offset + items.length : null;
  return {
    data,
    meta: { requestId: request.id, total: sorted.length, offset: query.offset, nextOffset },
  };
}

function applicationStages(deps: RouteDeps, candidateId: string, ids: readonly string[]) {
  const wanted = new Set(ids);
  const stages: Record<string, ApplicationStage> = {};
  for (const application of deps.candidateStore.listApplications(candidateId)) {
    if (application.clusterId && wanted.has(application.clusterId))
      stages[application.clusterId] = application.stage;
  }
  return stages;
}

async function enrichRoleRows(
  deps: RouteDeps,
  candidateId: string,
  targetLevel: Parameters<typeof addStoredVacancyLevels>[1],
  rows: readonly MatchedVacancyItem[],
) {
  const levels = addStoredVacancyLevels(rows.map(trim), targetLevel, (key) =>
    deps.titleParseStore.getByKey(key),
  );
  return withMarketSalary(deps, await withShownPageFitViews(deps, candidateId, levels));
}

async function getCompany(backgroundDeps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, backgroundDeps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  const parsed = cardSchema.safeParse(request.query);
  if (!parsed.success) return badQuery(request, reply);
  const deps = withRequestScopedCandidateReads(backgroundDeps);
  const companyId = (request.params as { companyId: string }).companyId;
  const context = await companyContext(deps, candidate.id);
  const row = findCompanyRow(context.rows, companyId);
  if (!row) return companyMissing(request, reply);
  const listContext = readB640ListContext(deps, candidate.id);
  const pool = (await readB640PoolRows(deps, request, candidate.id, listContext, {})) ?? [];
  const own = pool.filter((item) => candidateCompanyKey(item.cluster.canonicalCompany) === row.key);
  const byRoles = own.filter((item) => item.explanation.roleMatch !== 'none');
  const others = own.filter((item) => item.explanation.roleMatch === 'none');
  const { offset, limit } = parsed.data;
  const roleVacancies = await enrichRoleRows(
    deps,
    candidate.id,
    listContext.targetLevel,
    byRoles.slice(offset, offset + limit),
  );
  const otherVacancies = withMarketSalary(deps, others.slice(0, OTHER_LIMIT).map(trim));
  const fitLimit = selectionFitLimit(candidatePlan(deps, candidate.id));
  startShownPageFit(backgroundDeps, candidate.id, roleVacancies, 0, fitLimit, request);
  const shownIds = [...roleVacancies, ...otherVacancies].map((item) => item.cluster.id);
  const data: B640CompanyCard<MatchedVacancyItem> = {
    company: withRelocation([row], findCompany)[0]!,
    roleVacancies,
    roleTotal: byRoles.length,
    roleNextOffset:
      offset + roleVacancies.length < byRoles.length ? offset + roleVacancies.length : null,
    otherVacancies,
    otherTotal: others.length,
    applications: applicationStages(deps, candidate.id, shownIds),
  };
  return { data, meta: { requestId: request.id } };
}

/** B677: компании нового кабинета — релокация и города, карточка с совпадением и откликами, люди. */
export function registerB640CompanyRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const limited = { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } };
  app.get('/api/v1/candidate/b640/companies', limited, withDeps(deps, getCompanies));
  app.get('/api/v1/candidate/b640/companies/:companyId', limited, withDeps(deps, getCompany));
  registerB640CompanyPeopleRoute(app, deps);
}
