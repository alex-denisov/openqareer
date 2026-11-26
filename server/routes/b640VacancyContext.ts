import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { B640_PAGE_LIMIT_DEFAULT, B640_PAGE_LIMIT_MAX } from '../../shared/b640Vacancies';
import type { CandidateIdentity } from '../data/candidateStore';
import type { CampaignResolution } from '../vacancies/campaign';
import { matchGeographyOf } from '../vacancies/matchGeography';
import { readMatchProfile } from '../vacancies/matchedPoolContext';
import { campaignMeta, readCampaign } from './campaignContext';
import type { RouteDeps } from './deps';
import { sendError } from './helpers';
import { readTargetLevel } from './vacancyRoleContext';

/** Профиль, по которому читается подборка; те же входы, что у прежнего маршрута, чтобы снимок был общим. */
export interface B640ListContext {
  readonly confirmedSkills: string[];
  readonly targetRoles: string[];
  readonly campaign: CampaignResolution;
  readonly targetLevel: ReturnType<typeof readTargetLevel>;
  readonly geography: ReturnType<typeof matchGeographyOf>;
}

export function readB640ListContext(deps: RouteDeps, candidateId: string): B640ListContext {
  const { confirmedSkills } = readMatchProfile(deps.candidateStore, candidateId);
  const campaign = readCampaign(deps.candidateStore, candidateId);
  const targetRoles = [...campaign.roles.value];
  return {
    confirmedSkills,
    targetRoles,
    campaign,
    targetLevel: readTargetLevel(deps.candidateStore, candidateId, targetRoles),
    geography: matchGeographyOf(campaign.careerGeography),
  };
}

export const profileIsEmpty = (context: B640ListContext): boolean =>
  context.confirmedSkills.length === 0 && context.targetRoles.length === 0;

export const pagingSchema = {
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(B640_PAGE_LIMIT_MAX).default(B640_PAGE_LIMIT_DEFAULT),
};

export function nextOffsetOf(offset: number, shown: number, total: number): number | null {
  return offset + shown < total ? offset + shown : null;
}

/** Кандидат сессии; без него (учётная запись без профиля кандидата) — 401. */
export function sessionCandidate(
  request: FastifyRequest,
  reply: FastifyReply,
  candidate: CandidateIdentity | null | undefined,
): CandidateIdentity | null {
  if (candidate) return candidate;
  sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
  return null;
}

export function invalidQuery(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendError(reply, request, 400, 'invalid_query', 'Неверные параметры запроса вакансий.', false);
}

export { campaignMeta };
