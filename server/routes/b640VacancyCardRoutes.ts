import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolveRowVacancyCluster } from '../vacancies/poolVacancyCluster';
import { matchCandidateWithVacancy } from '../vacancies/vacancyMatcher';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { readB640ListContext, sessionCandidate } from './b640VacancyContext';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { withMarketSalary } from './matchedVacancyRoutes';

const BASE = '/api/v1/candidate/b640/vacancies';
const ID_MAX = 200;

/** Объяснение совпадения для одной вакансии — тем же сравнением, что и строка подборки. */
function cardItem(deps: RouteDeps, candidateId: string, clusterId: string): MatchedVacancyItem | undefined {
  const cluster = resolveRowVacancyCluster(deps.multiSourceEngine, clusterId);
  if (!cluster) return undefined;
  const context = readB640ListContext(deps, candidateId);
  const explanation = matchCandidateWithVacancy(
    {
      candidateId,
      targetRoles: context.targetRoles,
      confirmedSkills: context.confirmedSkills,
      confirmedFacts: [],
      ...(context.targetLevel ? { targetLevel: context.targetLevel } : {}),
    },
    cluster,
  );
  const [item] = withMarketSalary(deps, [{ cluster, explanation }]);
  return item;
}

/**
 * B715: карточка v04 для вакансии, которой нет в загруженной подборке кандидата — ссылка hh.ru
 * из «Своей вакансии» (`in_pool`), вакансия после отклика, переход по прямому адресу.
 */
function getVacancyCard(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  const id = (request.params as { id?: string }).id ?? '';
  const item = id && id.length <= ID_MAX ? cardItem(deps, candidate.id, id) : undefined;
  if (item) return { data: item, meta: { requestId: request.id } };
  if (id && deps.multiSourceEngine.isKnownVacancyGone?.(id)) {
    return sendError(reply, request, 410, 'vacancy_gone', 'Вакансия снята с площадки.', false);
  }
  return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
}

export function registerB640VacancyCardRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(`${BASE}/:id`, withDeps(deps, getVacancyCard));
}
