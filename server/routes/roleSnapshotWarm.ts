import { titleKey } from '../../shared/poolRoleHypotheses';
import { readCampaign } from './campaignContext';
import type { RouteDeps } from './deps';
import { backgroundStep } from '../observability/backgroundSteps';
import { readRoleSnapshot, warmAssessmentContext } from './roleSkillAssessmentRoutes';
import { readMatchProfile } from '../vacancies/matchedPoolContext';
import { readRoleLevel } from './vacancyRoleContext';

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
 * B775 (prod 23.11): the list warmer ran every precompute pass, 5 roles × 3 candidates every 5 min,
 * and rebuilt each snapshot and context — 52 % of event-loop stall seconds. A role is warmed again
 * only when its inputs change (profile skills, level, search roles) or its last warm is old; pool
 * enrichments in between reach «Карьера» through the read path, which rebuilds behind a stale snapshot.
 */
export const ROLE_REWARM_MS = 30 * 60_000;

export class RoleWarmMemo {
  private readonly warmed = new Map<string, { readonly inputs: string; readonly at: number }>();

  due(candidateId: string, roleKey: string, inputs: string, now: number): boolean {
    const last = this.warmed.get(`${candidateId}\u0000${roleKey}`);
    return !last || last.inputs !== inputs || now - last.at >= ROLE_REWARM_MS;
  }

  remember(candidateId: string, roleKey: string, inputs: string, now: number): void {
    this.warmed.set(`${candidateId}\u0000${roleKey}`, { inputs, at: now });
  }
}

const memos = new WeakMap<object, RoleWarmMemo>();

function memoOf(deps: RouteDeps): RoleWarmMemo {
  const known = memos.get(deps.candidateStore);
  if (known) return known;
  const created = new RoleWarmMemo();
  memos.set(deps.candidateStore, created);
  return created;
}

/** What a role snapshot is built from: confirmed skills, the role level and the search roles. */
function roleInputs(deps: RouteDeps, candidateId: string, role: string, roles: readonly string[]): string {
  const { confirmedSkills } = readMatchProfile(deps.candidateStore, candidateId);
  const level = readRoleLevel(deps.candidateStore, candidateId, role);
  return JSON.stringify([[...confirmedSkills].sort(), level, roles.map(titleKey)]);
}

interface WarmOptions {
  readonly memo?: RoleWarmMemo;
  readonly now?: number;
}

/**
 * B645 s09 (prod 19.11): a role snapshot was built only when «Карьера» asked, 15 s cold for each of
 * 11 roles. The background pass builds them one at a time; a fresh one is returned without a read.
 */
export async function warmRoleSnapshots(
  deps: RouteDeps,
  candidateId: string,
  log: WarmLog | undefined,
  options: WarmOptions = {},
): Promise<void> {
  const startedAt = performance.now();
  const roles = rolesToWarm(deps, candidateId);
  const memo = options.memo ?? memoOf(deps);
  const now = options.now ?? Date.now();
  let unavailable = 0;
  let skipped = 0;
  for (const role of roles) {
    const inputs = roleInputs(deps, candidateId, role, roles);
    if (!memo.due(candidateId, titleKey(role), inputs, now)) {
      skipped += 1;
      continue;
    }
    memo.remember(candidateId, titleKey(role), inputs, now);
    const snapshot = await backgroundStep('role-snapshot', () => readRoleSnapshot(deps, candidateId, role, { awaitRebuild: true }));
    if (snapshot.state !== 'matched') unavailable += 1;
    else await backgroundStep('role-assessment-context', () => warmAssessmentContext(deps, candidateId, role));
  }
  if (roles.length > 0) {
    log?.info(
      { roles: roles.length, skipped, unavailable, ms: Math.round(performance.now() - startedAt) },
      'role-snapshots-warmed',
    );
  }
}
