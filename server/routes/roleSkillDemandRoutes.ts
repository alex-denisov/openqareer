import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { MIN_ROLE_SAMPLE, titleKey } from '../../shared/poolRoleHypotheses';
import type { RoleAssessmentVacancy } from '../domain/roleSkillAssessment';
import { buildRoleSkillDemand } from '../domain/roleSkillDemand';
import { readCampaign } from './campaignContext';
import type { RouteDeps } from './deps';
import { authenticateCandidate, withDeps } from './helpers';
import { readRoleSnapshot, toAssessmentVacancies } from './roleSkillAssessmentRoutes';
import { RoleSkillDemandCache } from './roleSkillDemandCache';
import { createRoleRequirementReader } from './roleSkillRequirementSource';

/** The block reads at most this many target roles: each is one selection read. */
const MAX_DEMAND_ROLES = 5;
const DEMAND_TTL_MS = 6 * 60 * 60 * 1_000;

type RoleSample = { readonly roleTitle: string; readonly vacancies: readonly RoleAssessmentVacancy[] };

const caches = new WeakMap<RouteDeps, RoleSkillDemandCache<readonly RoleSample[]>>();

function cacheOf(deps: RouteDeps): RoleSkillDemandCache<readonly RoleSample[]> {
  let cache = caches.get(deps);
  if (!cache) {
    cache = new RoleSkillDemandCache((roles, candidateId) => readSamples(deps, candidateId, roles), {
      ttlMs: DEMAND_TTL_MS,
    });
    caches.set(deps, cache);
  }
  return cache;
}

/** Roles one at a time: a read holds the pool for seconds, never in parallel. */
async function readSamples(
  deps: RouteDeps,
  candidateId: string,
  roles: readonly string[],
): Promise<readonly RoleSample[]> {
  const samples: RoleSample[] = [];
  for (const roleTitle of roles) {
    const snapshot = await readRoleSnapshot(deps, candidateId, roleTitle);
    if (snapshot.state !== 'matched') throw new Error('selection source unavailable');
    const vacancies = toAssessmentVacancies(
      snapshot.vacancies,
      titleKey(roleTitle),
      new Date(),
      createRoleRequirementReader(deps),
    );
    samples.push({ roleTitle, vacancies });
  }
  return samples;
}

export function targetRolesOf(deps: RouteDeps, candidateId: string): string[] {
  const strategy = deps.candidateStore.getCareerStrategy(candidateId)?.current.role.title;
  const campaign = readCampaign(deps.candidateStore, candidateId).roles.value;
  const seen = new Set<string>();
  return [strategy, ...campaign]
    .filter((title): title is string => Boolean(title?.trim()))
    .filter((title) => {
      const key = titleKey(title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_DEMAND_ROLES);
}

function profileSkillsOf(deps: RouteDeps, candidateId: string): string[] {
  const skills = deps.candidateStore.getSnapshot(candidateId)?.resume?.draft.skills ?? [];
  return skills.map((skill) => skill.name);
}

async function handleDemand(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const roles = targetRolesOf(deps, candidate.id);
  if (roles.length === 0) return reply.send({ data: { state: 'ready', roles: [] } });
  const cached = cacheOf(deps).read(candidate.id, roles);
  if (cached.state === 'pending') return reply.send({ data: { state: 'pending', roles: [] } });
  const profileSkills = profileSkillsOf(deps, candidate.id);
  const demand = cached.value.flatMap(({ roleTitle, vacancies }) => {
    const summary = buildRoleSkillDemand(
      roleTitle,
      titleKey(roleTitle),
      vacancies,
      profileSkills,
      MIN_ROLE_SAMPLE,
    );
    return summary ? [summary] : [];
  });
  return reply.send({ data: { state: 'ready', roles: demand } });
}

/** «Проверка навыков» in the profile: what real vacancies of each target role ask for (B591). */
export function registerRoleSkillDemandRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    '/api/v1/candidate/role-skill-demand',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    withDeps(deps, handleDemand),
  );
}
