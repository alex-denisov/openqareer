import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApplyTarget } from '../../shared/applyTarget';
import { applyRedirects } from '../vacancies/applyRedirect';
import { resolveVacancyApplyTarget } from '../vacancies/vacancyApplyTarget';
import { SqliteHhSessionRepository } from '../candidate/sqliteHhSessionRepository';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { withHhAttempt } from '../vacancies/hhAttemptHold';
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

type VacancyCard = MatchedVacancyItem & { readonly applyTarget: ApplyTarget | null };

type CardDeps = RouteDeps & { readonly hh: SqliteHhSessionRepository };

function cardCluster(deps: CardDeps, candidateId: string, id: string): VacancyCluster | undefined {
  const cluster = resolveRowVacancyCluster(deps.multiSourceEngine, id);
  return cluster && withHhAttempt(cluster, deps.hh.vacancyInProgress(candidateId, id, new Date()));
}

/** Объяснение совпадения для одной вакансии — тем же сравнением, что и строка подборки. */
function cardItem(deps: CardDeps, candidateId: string, clusterId: string): VacancyCard | undefined {
  const cluster = cardCluster(deps, candidateId, clusterId);
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
  return (
    item && {
      ...item,
      applyTarget: resolveVacancyApplyTarget(deps.multiSourceEngine, cluster, applyRedirects.peek),
    }
  );
}

/**
 * B715: карточка v04 для вакансии, которой нет в загруженной подборке кандидата — ссылка hh.ru
 * из «Своей вакансии» (`in_pool`), вакансия после отклика, переход по прямому адресу.
 */
function getVacancyCard(deps: CardDeps, request: FastifyRequest, reply: FastifyReply) {
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

/** B787: кандидат открыл отклик — адрес трекера раскрывается одним переходом и запоминается. */
async function postApplyTarget(deps: CardDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  const id = (request.params as { id?: string }).id ?? '';
  const cluster = id && id.length <= ID_MAX ? cardCluster(deps, candidate.id, id) : undefined;
  if (!cluster)
    return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
  const read = () =>
    resolveVacancyApplyTarget(deps.multiSourceEngine, cluster, applyRedirects.peek);
  const target = read();
  if (target?.needsRedirect && (await applyRedirects.resolve(target.url, candidate.id))) {
    return { data: { applyTarget: read() }, meta: { requestId: request.id } };
  }
  return { data: { applyTarget: target }, meta: { requestId: request.id } };
}

export function registerB640VacancyCardRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const hh = new SqliteHhSessionRepository({
    databasePath: deps.config.databasePath,
    encryptionKey: deps.config.dataEncryptionKey,
  });
  app.addHook('onClose', async () => hh.close());
  const bound: CardDeps = { ...deps, hh };
  app.post(`${BASE}/:id/apply-target`, withDeps(bound, postApplyTarget));
  app.get(`${BASE}/:id`, withDeps(bound, getVacancyCard));
}
