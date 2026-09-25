import type { AccountSnapshot } from '../coach/coachApi';
import { prepareCareerWorkspace } from '../journey/careerJourneyEngine';
import {
  normalizeCandidateRegions,
  type CandidateRegion,
} from '../workspace/candidateRegions';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';

export type RouteWorkMode = NonNullable<AccountSnapshot['profile']['workMode']>;

/**
 * The three premises «Карьера» shows above the route. They live in two places
 * on the server — the role and the regions are the candidate's wizard answers,
 * the work mode is an account profile field — so the editor reads and writes
 * both rather than pretending one store owns all three (B160).
 */
export interface RoutePremisesDraft {
  readonly targetRole: string;
  readonly regions: readonly CandidateRegion[];
  readonly workMode: RouteWorkMode | null;
}

export interface AccountProfilePatch {
  readonly headline?: string;
  readonly workMode?: RouteWorkMode | null;
}

/**
 * The editor opens on the same resolved role the candidate is looking at.
 * Otherwise saving an untouched form would silently rewrite the role to an
 * older store's copy.
 */
export function routePremisesDraft({
  workspace,
  account,
  visibleTargetRole,
}: {
  workspace?: CandidateWorkspace;
  account?: AccountSnapshot;
  visibleTargetRole?: string;
}): RoutePremisesDraft {
  return {
    targetRole:
      visibleTargetRole?.trim() ||
      account?.profile.headline?.trim() ||
      workspace?.targetDirection?.trim() ||
      '',
    regions: normalizeCandidateRegions(workspace?.regions ?? []),
    workMode: account?.profile.workMode ?? null,
  };
}

/**
 * A blank role is not an answer. Keeping the previous one is honest; storing
 * an empty string would erase a premise the candidate never revoked.
 */
export function applyRoutePremises(
  workspace: CandidateWorkspace,
  draft: RoutePremisesDraft,
  now?: string,
): CandidateWorkspace {
  const targetDirection = draft.targetRole.trim() || workspace.targetDirection;
  return prepareCareerWorkspace(
    {
      careerGoal: workspace.careerGoal,
      resumeText: workspace.resumeText,
      resumeSource: workspace.resumeSource,
      resumeFileName: workspace.resumeFileName,
      resumePageCount: workspace.resumePageCount,
      targetDirection,
      regions: normalizeCandidateRegions(draft.regions),
      currentSituation: workspace.currentSituation,
      constraints: workspace.constraints,
      urgency: workspace.urgency,
      linkedinUrl: workspace.linkedinUrl,
      hhUrl: workspace.hhUrl,
      resumeImported: workspace.resumeImported,
    },
    now,
    workspace,
  );
}

/**
 * Returns only what actually changed, and `null` when nothing did — an
 * unchanged form must not issue a write that stamps a new `updatedAt` and
 * tells the candidate their profile changed when it did not.
 */
export function routePremisesAccountPatch(
  draft: RoutePremisesDraft,
  account?: AccountSnapshot,
): AccountProfilePatch | null {
  const patch: { headline?: string; workMode?: RouteWorkMode | null } = {};
  const role = draft.targetRole.trim();
  if (role && role !== (account?.profile.headline?.trim() ?? '')) patch.headline = role;
  if (draft.workMode !== (account?.profile.workMode ?? null)) patch.workMode = draft.workMode;
  return Object.keys(patch).length > 0 ? patch : null;
}
