import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin } from './helpers';
import {
  resolveApplicationContacts,
  type ResolvedApplicationContact,
} from '../domain/applicationContact';
import { ApplicationNotFoundError } from '../data/store/errors';

/** Контакты откликов кандидата: свой контакт или рекрутер из вакансии (B542). */
export function readApplicationContacts(
  deps: RouteDeps,
  candidateId: string,
  applications: readonly { readonly id: string; readonly clusterId: string | null }[],
): ReadonlyMap<string, ResolvedApplicationContact> {
  return resolveApplicationContacts(
    applications,
    deps.candidateStore.listApplicationContacts?.(candidateId) ?? new Map(),
    deps.recruiterContactsRepo?.listContactsByCandidateId(candidateId) ?? [],
  );
}

const contactInput = z.object({ name: z.string().trim().max(120).nullable() }).strict();
const applicationParams = z.object({ id: z.string().min(1).max(200) });

/**
 * B542: «Скрыть уведомление» у полосы «С ДД.ММ» хранится в рабочем
 * пространстве на сервере, а контакт отклика называет человека в
 * напоминании «Сегодня».
 */
export function registerTodayChangesRoutes(app: FastifyInstance, deps: RouteDeps): void {
  registerDismissRoute(app, deps);
  registerContactRoutes(app, deps);
}

function registerDismissRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/candidate/today/changes/dismiss',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    async (request, reply) => {
      if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
      const candidate = authenticateCandidate(
        request,
        reply,
        deps.candidateStore,
        deps.authService,
        deps.config,
      );
      if (!candidate) return undefined;
      const workspace = deps.candidateStore.getCandidateWorkspace(candidate.id);
      if (!workspace)
        return reply.code(409).send({
          error: { code: 'workspace_required', message: 'Сначала завершите первый запуск.' },
        });
      const dismissedAt = new Date().toISOString();
      deps.candidateStore.saveCandidateWorkspace(candidate.id, {
        ...workspace,
        todayChangesDismissedAt: dismissedAt,
      });
      return { data: { dismissedAt }, meta: { requestId: request.id } };
    },
  );
}

function registerContactRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/applications/:id/contact', async (request, reply) => {
    const candidate = authenticateCandidate(
      request,
      reply,
      deps.candidateStore,
      deps.authService,
      deps.config,
    );
    if (!candidate) return undefined;
    const { id } = applicationParams.parse(request.params);
    const application = deps.candidateStore.getApplication(candidate.id, id);
    if (!application) throw new ApplicationNotFoundError(id);
    const contact = readApplicationContacts(deps, candidate.id, [application]).get(id) ?? null;
    return { data: contact, meta: { requestId: request.id } };
  });

  app.put(
    '/api/v1/candidate/applications/:id/contact',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    async (request, reply) => {
      if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
      const candidate = authenticateCandidate(
        request,
        reply,
        deps.candidateStore,
        deps.authService,
        deps.config,
      );
      if (!candidate) return undefined;
      const { id } = applicationParams.parse(request.params);
      const { name } = contactInput.parse(request.body);
      deps.candidateStore.setApplicationContact?.(candidate.id, id, name || null);
      return { data: { applicationId: id, name: name || null }, meta: { requestId: request.id } };
    },
  );
}
