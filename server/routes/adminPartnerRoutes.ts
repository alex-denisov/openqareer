import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isCareerPartnerRole } from '../../shared/roleMatrix';
import { CANDIDATE_REGIONS } from '../../src/features/workspace/candidateRegions';
import type { AuthPrincipal, CareerPartnerCandidate } from '../auth/authTypes';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import type { RouteDeps } from './deps';
import { requireAdmin, requireAdminMutation } from './adminAuth';
import { campaignMeta, readCampaign } from './campaignContext';
import {
  adminPartnerAssignmentQuerySchema,
  adminPartnerAssignmentSchema,
  adminPartnerCandidateQuerySchema,
} from './schemas';
import { sendError, withDeps } from './helpers';

function requirePartner(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  mutation = false,
): AuthPrincipal | null {
  const principal = mutation
    ? requireAdminMutation(deps, request, reply)
    : requireAdmin(deps, request, reply);
  if (!principal) return null;
  if (isCareerPartnerRole(principal.role)) return principal;
  void sendError(reply, request, 403, 'forbidden', 'Раздел доступен карьерному партнёру.', false);
  return null;
}

const partnerCampaignRoleSchema = z.union([
  z.string().trim().min(1).max(200),
  z
    .object({ id: z.string().min(1).optional(), title: z.string().trim().min(1).max(200) })
    .passthrough(),
]);

const partnerCampaignPatchSchema = z.object({
  roles: z.array(partnerCampaignRoleSchema).max(10),
  regions: z.array(z.enum(CANDIDATE_REGIONS)).max(CANDIDATE_REGIONS.length),
  remoteOnly: z.boolean().optional(),
});

function removedAutoRoleIds(
  campaign: CandidateWorkspaceState['campaign'],
  kept: ReadonlySet<string>,
): string[] {
  const selected = new Set(campaign?.roles ?? []);
  return (campaign?.auto?.roles ?? [])
    .filter(
      (role) =>
        (selected.has(role.id) || selected.has(role.title)) &&
        !kept.has(role.id) &&
        !kept.has(role.title),
    )
    .map((role) => role.id);
}

function publicCandidate(candidate: CareerPartnerCandidate) {
  return {
    userId: candidate.userId,
    displayName: candidate.displayName,
    headline: candidate.headline,
    location: candidate.location,
  };
}

async function handleListCandidates(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requirePartner(deps, request, reply);
  if (!principal) return;
  const query = adminPartnerCandidateQuerySchema.parse(request.query ?? {});
  const page = deps.authService.listCareerPartnerCandidates?.(
    principal.userId,
    query.limit,
    query.offset,
  );
  if (!page)
    return sendError(reply, request, 503, 'unavailable', 'Список кандидатов недоступен.', true);
  const permissionSnapshot = deps.authService.getAdminPermissionSnapshot?.(principal.userId);
  if (!permissionSnapshot) {
    return sendError(reply, request, 503, 'unavailable', 'Права партнёра недоступны.', true);
  }
  return {
    data: {
      ...page,
      items: page.items.map(publicCandidate),
      permissions: permissionSnapshot.permissions,
    },
    meta: { requestId: request.id },
  };
}

async function handleGetCandidate(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requirePartner(deps, request, reply);
  if (!principal) return;
  const { candidateUserId } = request.params as { candidateUserId: string };
  const candidate = deps.authService.getAssignedCareerPartnerCandidate?.(
    principal.userId,
    candidateUserId,
  );
  if (!candidate) return sendError(reply, request, 404, 'not_found', 'Кандидат не найден.', false);
  try {
    const snapshot = deps.candidateStore.getSnapshot(candidate.candidateId);
    const applications = deps.candidateStore.listApplications(candidate.candidateId);
    return {
      data: {
        candidate: publicCandidate(candidate),
        resume: snapshot.resume ? { draft: snapshot.resume.draft } : null,
        applications: {
          total: applications.length,
          funnel: deps.candidateStore.applicationFunnel(candidate.candidateId),
        },
      },
      meta: { requestId: request.id },
    };
  } catch (error) {
    request.log.error({ error }, 'partner_candidate_read_failed');
    return sendError(
      reply,
      request,
      500,
      'candidate_read_failed',
      'Не удалось открыть профиль кандидата.',
      true,
    );
  }
}

async function handleGetCandidateCampaign(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const principal = requirePartner(deps, request, reply);
  if (!principal) return;
  const { candidateUserId } = request.params as { candidateUserId: string };
  const candidate = deps.authService.getAssignedCareerPartnerCandidate?.(
    principal.userId,
    candidateUserId,
  );
  if (!candidate) return sendError(reply, request, 404, 'not_found', 'Кандидат не найден.', false);
  return {
    data: campaignMeta(readCampaign(deps.candidateStore, candidate.candidateId)),
    meta: { requestId: request.id },
  };
}

async function handlePatchCandidateCampaign(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const principal = requirePartner(deps, request, reply, true);
  if (!principal) return;
  const { candidateUserId } = request.params as { candidateUserId: string };
  const candidate = deps.authService.getAssignedCareerPartnerCandidate?.(
    principal.userId,
    candidateUserId,
  );
  if (!candidate) return sendError(reply, request, 404, 'not_found', 'Кандидат не найден.', false);
  const body = partnerCampaignPatchSchema.parse(request.body);
  const stored = deps.candidateStore.getCandidateWorkspace(candidate.candidateId);
  if (!stored) {
    return sendError(
      reply,
      request,
      409,
      'candidate_workspace_required',
      'Кандидат ещё не заполнил рабочий профиль.',
      false,
    );
  }
  return savePartnerCampaign(deps, request, candidate.candidateId, stored, body);
}

function savePartnerCampaign(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  stored: CandidateWorkspaceState,
  body: z.infer<typeof partnerCampaignPatchSchema>,
) {
  const roles = body.roles.map((role) => (typeof role === 'string' ? role : role.title));
  const kept = new Set(
    body.roles.flatMap((role) =>
      typeof role === 'string'
        ? [role]
        : [role.id, role.title].filter((value): value is string => Boolean(value)),
    ),
  );
  const dismissed = [
    ...new Set([
      ...(stored.campaign?.dismissed ?? []),
      ...removedAutoRoleIds(stored.campaign, kept),
    ]),
  ];
  const campaign: NonNullable<CandidateWorkspaceState['campaign']> = {
    roles,
    regions: body.regions,
    remoteOnly: body.remoteOnly ?? stored.campaign?.remoteOnly ?? false,
    revision: (stored.campaign?.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
    ...(stored.campaign?.auto ? { auto: stored.campaign.auto } : {}),
    ...(dismissed.length ? { dismissed } : {}),
  };
  deps.candidateStore.saveCandidateWorkspace(candidateId, { ...stored, campaign });
  deps.matchedPoolPrecompute?.prioritizeCampaign(candidateId);
  return {
    data: campaignMeta(readCampaign(deps.candidateStore, candidateId)),
    meta: { requestId: request.id },
  };
}

function requireAdminUser(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  mutation = false,
): AuthPrincipal | null {
  const principal = mutation
    ? requireAdminMutation(deps, request, reply)
    : requireAdmin(deps, request, reply);
  if (!principal) return null;
  if (principal.role === 'admin') return principal;
  void sendError(reply, request, 403, 'forbidden', 'Недостаточно прав.', false);
  return null;
}

async function handleListAssignments(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!requireAdminUser(deps, request, reply)) return;
  const { userId } = request.params as { userId: string };
  const partner = deps.authService.getUser?.(userId);
  if (partner?.role !== 'CareerPartner') {
    return sendError(reply, request, 404, 'not_found', 'Карьерный партнёр не найден.', false);
  }
  const query = adminPartnerAssignmentQuerySchema.parse(request.query ?? {});
  const page = deps.authService.listCareerPartnerCandidates?.(userId, query.limit, query.offset);
  if (!page)
    return sendError(reply, request, 503, 'unavailable', 'Список закреплений недоступен.', true);
  return {
    data: { ...page, items: page.items.map(publicCandidate) },
    meta: { requestId: request.id },
  };
}

async function handleAddAssignment(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const actor = requireAdminUser(deps, request, reply, true);
  if (!actor) return;
  const { userId } = request.params as { userId: string };
  const body = adminPartnerAssignmentSchema.parse(request.body ?? {});
  try {
    const created = deps.authService.assignCandidateToPartner?.(
      userId,
      body.candidateUserId,
      actor,
    );
    if (created === undefined) {
      return sendError(
        reply,
        request,
        503,
        'unavailable',
        'Изменение закреплений недоступно.',
        true,
      );
    }
    return reply.code(created ? 201 : 200).send({
      data: { assigned: true },
      meta: { requestId: request.id },
    });
  } catch (error) {
    return sendAssignmentError(reply, request, error);
  }
}

async function handleRemoveAssignment(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const actor = requireAdminUser(deps, request, reply, true);
  if (!actor) return;
  const { userId, candidateUserId } = request.params as {
    userId: string;
    candidateUserId: string;
  };
  try {
    const removed = deps.authService.removeCandidateFromPartner?.(userId, candidateUserId, actor);
    if (removed === undefined) {
      return sendError(
        reply,
        request,
        503,
        'unavailable',
        'Изменение закреплений недоступно.',
        true,
      );
    }
    if (!removed)
      return sendError(reply, request, 404, 'not_found', 'Закрепление не найдено.', false);
    return { data: { assigned: false }, meta: { requestId: request.id } };
  } catch (error) {
    return sendAssignmentError(reply, request, error);
  }
}

function sendAssignmentError(reply: FastifyReply, request: FastifyRequest, error: unknown) {
  if (error instanceof Error && error.message === 'Партнёр или кандидат не найден.') {
    return sendError(reply, request, 404, 'not_found', error.message, false);
  }
  request.log.error({ error }, 'partner_assignment_update_failed');
  return sendError(
    reply,
    request,
    500,
    'assignment_update_failed',
    'Не удалось изменить закрепление.',
    true,
  );
}

export function registerAdminPartnerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/admin/partner/candidates', withDeps(deps, handleListCandidates));
  app.get('/api/v1/admin/partner/candidates/:candidateUserId', withDeps(deps, handleGetCandidate));
  app.get(
    '/api/v1/admin/partner/candidates/:candidateUserId/campaign',
    withDeps(deps, handleGetCandidateCampaign),
  );
  app.patch(
    '/api/v1/admin/partner/candidates/:candidateUserId/campaign',
    withDeps(deps, handlePatchCandidateCampaign),
  );
  app.get('/api/v1/admin/users/:userId/partner-assignments', withDeps(deps, handleListAssignments));
  app.post('/api/v1/admin/users/:userId/partner-assignments', withDeps(deps, handleAddAssignment));
  app.delete(
    '/api/v1/admin/users/:userId/partner-assignments/:candidateUserId',
    withDeps(deps, handleRemoveAssignment),
  );
}
