import { titleKey } from '../../shared/poolRoleHypotheses';
import { readCampaign } from './campaignContext';
import type { RouteDeps } from './deps';
import { backgroundStep } from '../observability/backgroundSteps';
import { readRoleSnapshot, warmAssessmentContext } from './roleSkillAssessmentRoutes';

interface WarmLog {
  info(fields: Record<string, unknown>, message: string): void;
}

/** The strategy role and the campaign roles, once each: «Карьера» asks about every one. */
function rolesToWarm(deps: RouteDeps, candidateId: string): string[] {
  const strategy = deps.candidateStore.getCareerStrategy(candidateId)?.current.role.title;
  const campaign = readCampaign(deps.candidateStore, candidateId).roles.value;
  const seen = new Set<string>();
  return [strategy, ...campaign].filter((title): title is string => {
    if (!title?.trim()) return false;
    const key = titleKey(title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * B645 s09 (prod 19.11): a role snapshot was built only when «Карьера» asked, 15 s cold for each of
 * 11 roles. The background pass builds them one at a time; a fresh one is returned without a read.
 */
export async function warmRoleSnapshots(
  deps: RouteDeps,
  candidateId: string,
  log: WarmLog | undefined,
): Promise<void> {
  const startedAt = performance.now();
  const roles = rolesToWarm(deps, candidateId);
  let unavailable = 0;
  for (const role of roles) {
    const snapshot = await backgroundStep('role-snapshot', () => readRoleSnapshot(deps, candidateId, role, { awaitRebuild: true }));
    if (snapshot.state !== 'matched') unavailable += 1;
    else await backgroundStep('role-assessment-context', () => warmAssessmentContext(deps, candidateId, role));
  }
  if (roles.length > 0) {
    log?.info(
      { roles: roles.length, unavailable, ms: Math.round(performance.now() - startedAt) },
      'role-snapshots-warmed',
    );
  }
}
