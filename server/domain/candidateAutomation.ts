import type { VacancyRoleMatch } from '../../shared/vacancyMatchOrder';

export type CandidateAutomationPlatform = 'hh' | 'linkedin';
export type CandidateAutomationQueueStatus =
  | 'letter_not_ready'
  | 'pending_approval'
  | 'approved'
  | 'removed'
  | 'consultant'
  | 'sent'
  | 'attempted'
  | 'failed';

export interface CandidateAutomationRules {
  readonly roles: readonly string[];
  readonly minimumMatchPercent: number;
  readonly platforms: readonly CandidateAutomationPlatform[];
  readonly excludeStopCompanies: boolean;
}

export interface CandidateAutomationOpportunity {
  readonly roleMatch: VacancyRoleMatch;
  readonly requirements?: { readonly matched: number; readonly total: number };
  readonly platform: CandidateAutomationPlatform | 'other';
  readonly company: string;
}

export type CandidateAutomationQueueAction =
  | 'approve'
  | 'remove'
  | 'consultant'
  | 'update_letter'
  | 'sent'
  | 'attempted'
  | 'failed';

export function companyStopKey(value: string): string | null {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru');
  return normalized.length > 0 ? normalized : null;
}

export function matchesCandidateAutomationRules(
  opportunity: CandidateAutomationOpportunity,
  rules: CandidateAutomationRules,
  stoppedCompanyKeys: ReadonlySet<string>,
): boolean {
  const companyKey = companyStopKey(opportunity.company);
  if (rules.roles.length === 0 || opportunity.roleMatch === 'none') return false;
  if (opportunity.platform === 'other' || !rules.platforms.includes(opportunity.platform)) return false;
  if (rules.excludeStopCompanies && companyKey && stoppedCompanyKeys.has(companyKey)) return false;
  return meetsMinimumMatch(opportunity.requirements, rules.minimumMatchPercent);
}

function meetsMinimumMatch(
  requirements: CandidateAutomationOpportunity['requirements'],
  minimumMatchPercent: number,
): boolean {
  if (!requirements || requirements.total < 1 || requirements.matched < 0) return false;
  if (requirements.matched > requirements.total) return false;
  return (requirements.matched / requirements.total) * 100 >= minimumMatchPercent;
}

export function transitionCandidateAutomationQueue(
  current: CandidateAutomationQueueStatus,
  action: CandidateAutomationQueueAction,
  letterReady: boolean,
): CandidateAutomationQueueStatus {
  if (action === 'update_letter' && (current === 'pending_approval' || current === 'letter_not_ready')) {
    return letterReady ? 'pending_approval' : 'letter_not_ready';
  }
  if (action === 'approve' && current === 'letter_not_ready') {
    throw new Error('automation_letter_not_ready');
  }
  const next = nextQueueStatus(current, action);
  if (!next) throw new Error('automation_transition_not_allowed');
  return next;
}

function nextQueueStatus(
  current: CandidateAutomationQueueStatus,
  action: CandidateAutomationQueueAction,
): CandidateAutomationQueueStatus | null {
  if (current === 'pending_approval') {
    if (action === 'approve') return 'approved';
    if (action === 'remove') return 'removed';
    if (action === 'consultant') return 'consultant';
  }
  if (current === 'letter_not_ready') {
    if (action === 'remove') return 'removed';
    if (action === 'consultant') return 'consultant';
  }
  if (current === 'approved' && ['remove', 'sent', 'attempted', 'failed'].includes(action)) {
    return action as CandidateAutomationQueueStatus;
  }
  return null;
}
