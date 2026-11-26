import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { buildCandidateFootprintQueryPlan } from '../osint/candidateFootprintQueryPlan';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

const bodySchema = z.object({ link: z.string().trim().min(1).max(500).url() }).strict();

/**
 * B668: ссылка, которую кандидат сам добавил в «Данные для поиска», входит в повтор
 * последней проверки. Прочие неотмеченные данные в повтор не попадают.
 */
async function handleAddedLink(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  const candidateId = principal.candidate?.id;
  const repo = deps.candidateReputationRepo;
  if (!candidateId || !repo)
    return sendError(reply, request, 401, 'unauthorized', 'Нужна сессия кандидата.', false);
  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success)
    return sendError(reply, request, 400, 'invalid_request', 'Это не адрес страницы.', false);
  const draft = deps.candidateStore.getSnapshot(candidateId).resume?.draft ?? EMPTY_RESUME_DRAFT;
  const ids = buildCandidateFootprintQueryPlan(draft, { youtube: true })
    .filter(({ input }) => 'profileUrl' in input && input.profileUrl === parsed.data.link)
    .map((item) => item.id);
  repo.addFootprintQueryIds(candidateId, ids);
  return reply.code(204).send();
}

export function registerFootprintAddedLinkRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/candidate/footprint/added-links',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    withDeps(deps, handleAddedLink),
  );
}
