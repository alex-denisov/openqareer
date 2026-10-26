import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { careerRoleId } from '../../shared/roleProposals';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import { campaignMeta, readCampaign } from './campaignContext';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, sendError } from './helpers';

const MAX_WIZARD_ROLES = 10;
const ROLE_REJECTION_PREFIX = 'career-role:';

const careerRoleChangeSchema = z
  .object({
    action: z.enum(['add', 'remove']),
    title: z.string().trim().min(2).max(200),
  })
  .strict();

/**
 * Роль «Карьеры», добавленная или убранная кандидатом — по предложению
 * консультанта или сама (замечание владельца 26.10). Добавленная роль
 * становится выбором кандидата в кампании и снимает прежнее отклонение;
 * убранная — отклонением, которое исключает её и из «Карьеры», и из подбора.
 */
export async function handleChangeCareerRole(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const parsed = careerRoleChangeSchema.safeParse(request.body);
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_role', 'Название роли не прочиталось.', false);
  }
  const stored = deps.candidateStore.getCandidateWorkspace(candidate.id);
  if (!stored) {
    const message = 'Сначала заполните профиль: роли «Карьеры» строятся по нему.';
    return sendError(reply, request, 409, 'workspace_required', message, false);
  }
  const applied = applyRoleChange(deps, candidate.id, stored, parsed.data);
  if (!applied) {
    const message = 'В подборе уже десять ролей. Уберите одну, чтобы добавить новую.';
    return sendError(reply, request, 409, 'too_many_roles', message, false);
  }
  deps.matchedPoolPrecompute?.prioritizeCampaign(candidate.id);
  return {
    data: campaignMeta(readCampaign(deps.candidateStore, candidate.id)),
    meta: { requestId: request.id },
  };
}

/** `false` — добавлять некуда: выбор кандидата уже держит десять ролей. */
function applyRoleChange(
  deps: RouteDeps,
  candidateId: string,
  stored: CandidateWorkspaceState,
  { action, title }: z.infer<typeof careerRoleChangeSchema>,
): boolean {
  const id = careerRoleId(title);
  const rejectionKey = `${ROLE_REJECTION_PREFIX}${id}`;
  const campaign = stored.campaign ?? {
    roles: [],
    regions: [],
    revision: 0,
    updatedAt: new Date().toISOString(),
  };
  const others = campaign.roles.filter((role) => careerRoleId(role) !== id);
  if (action === 'add' && others.length >= MAX_WIZARD_ROLES) return false;
  if (action === 'add') deps.candidateStore.withdrawConsultantRejection(candidateId, rejectionKey);
  else deps.candidateStore.rejectConsultantProposal(candidateId, rejectionKey, 'Роль убрана кандидатом');
  deps.candidateStore.saveCandidateWorkspace(candidateId, {
    ...stored,
    campaign: {
      ...campaign,
      roles: action === 'add' ? [...others, title] : others,
      revision: campaign.revision + 1,
      updatedAt: new Date().toISOString(),
    },
  });
  return true;
}
