import type { FastifyReply, FastifyRequest } from 'fastify';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { resolveRowVacancyCluster } from '../vacancies/poolVacancyCluster';
import type { RouteDeps } from './deps';
import { sendError } from './helpers';

type GuardDeps = Pick<RouteDeps, 'candidateStore' | 'multiSourceEngine'>;

/** B801: отклик на эту вакансию уже отправлен; черновик-дубль рядом ничего не меняет. */
export function sentApplicationFor(
  deps: GuardDeps,
  candidateId: string,
  vacancyId: string,
  cluster: VacancyCluster | undefined = resolveRowVacancyCluster(deps.multiSourceEngine, vacancyId),
) : string | null {
  return deps.candidateStore.findSentApplication(candidateId, {
    clusterId: vacancyId,
    title: cluster?.canonicalTitle,
    urls: cluster ? [cluster.primaryUrl, ...cluster.sources.map((source) => source.sourceUrl)] : [],
  });
}

/** Отказ с id отправленного отклика уже отправлен, когда `true`. */
export function refuseWhenSent(
  deps: GuardDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidateId: string,
  vacancyId: string,
): boolean {
  const sent = sentApplicationFor(deps, candidateId, vacancyId);
  if (!sent) return false;
  sendError(reply, request, 409, 'already_applied', 'Отклик уже отправлен.', false, undefined, {
    applicationId: sent,
  });
  return true;
}
