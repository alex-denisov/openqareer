import type { ReferralRequest } from '../data/sqliteReferralRequestRepository';
import { canonicalLinkedInProfile } from '../data/sqliteNetworkIndexRepository';
import {
  candidateCompanyKey,
  type PlatformReferralIntroducer,
  type PlatformReferralView,
} from '../domain/candidateCompanies';
import type { RouteDeps } from './deps';
import { connectionRecords } from './candidateConnectionRoutes';
import { memberSharesContacts } from './networkIndexFeed';

/**
 * B561 slice 3: what each side of a referral request may see. The candidate sees a
 * member and the member's people at the company only once that member accepted and
 * still shares contacts; the member sees who asks, and the asker's LinkedIn address
 * only after accepting. E-mail and phone are never shown to either side.
 */
type ReferralDeps = Pick<
  RouteDeps,
  | 'networkIndexRepo'
  | 'capabilityConsentStore'
  | 'referralRequestRepo'
  | 'recruiterContactsRepo'
  | 'candidateStore'
>;

export interface ReferralProfile {
  readonly fullName: string;
  readonly headline: string | null;
  readonly linkedinUrl: string | null;
}

const NO_REFERRAL: PlatformReferralView = { status: 'none', introducers: [] };

export function readReferralProfile(deps: ReferralDeps, candidateId: string): ReferralProfile {
  let candidate: { fullName?: string; headline?: string; contact?: { linkedinUrl?: string } } = {};
  try {
    candidate = deps.candidateStore.getSnapshot(candidateId).resume?.draft.candidate ?? {};
  } catch {
    candidate = {};
  }
  const linkedinUrl = candidate.contact?.linkedinUrl
    ? canonicalLinkedInProfile(candidate.contact.linkedinUrl)
    : null;
  // Free text from the profile: kept short, and the UI says it is not verified.
  return {
    fullName: candidate.fullName?.trim().slice(0, 120) || 'Участник платформы',
    headline: candidate.headline?.trim().slice(0, 160) || null,
    linkedinUrl,
  };
}

/** The member's own contacts at the company, read from the member's own list. */
export function memberPeopleAt(
  deps: ReferralDeps,
  memberId: string,
  companyKey: string,
): Array<{ fullName: string; roleTitle: string; linkedinUrl: string }> {
  if (!deps.networkIndexRepo || !deps.recruiterContactsRepo) return [];
  const profiles = new Set(deps.networkIndexRepo.memberProfilesAt(memberId, companyKey));
  if (profiles.size === 0) return [];
  return connectionRecords(deps.recruiterContactsRepo, memberId).flatMap((record) => {
    if (record.sourceType !== 'candidate_linkedin_connection' || !record.linkedinUrl) return [];
    const url = canonicalLinkedInProfile(record.linkedinUrl);
    if (!url || !profiles.has(url)) return [];
    profiles.delete(url);
    return [{ fullName: record.fullName, roleTitle: record.roleTitle, linkedinUrl: url }];
  });
}

/** Circle 2 for the asking candidate: the request state and, once accepted, the introducers. */
export function platformReferralFor(
  deps: ReferralDeps,
  candidateId: string,
  companyName: string,
): PlatformReferralView {
  const name = companyName.trim();
  if (!deps.referralRequestRepo || !name) return NO_REFERRAL;
  const companyKey = candidateCompanyKey(name);
  const requests = deps.referralRequestRepo
    .outgoingFor(candidateId, companyKey)
    .filter((request) => request.status !== 'withdrawn');
  const introducers = requests
    .filter(
      (request) => request.status === 'accepted' && memberSharesContacts(deps, request.memberId),
    )
    .map((request) => introducer(deps, request))
    .filter((item) => item.people.length > 0);
  return { status: referralStatus(requests, introducers.length), introducers };
}

function introducer(deps: ReferralDeps, request: ReferralRequest): PlatformReferralIntroducer {
  return {
    ...readReferralProfile(deps, request.memberId),
    people: memberPeopleAt(deps, request.memberId, request.companyKey).map((person) => ({
      fullName: person.fullName,
    })),
  };
}

function referralStatus(
  requests: readonly ReferralRequest[],
  introducers: number,
): PlatformReferralView['status'] {
  if (introducers > 0) return 'accepted';
  if (requests.some((request) => request.status === 'pending')) return 'pending';
  return requests.some((request) => request.status === 'declined') ? 'answered' : 'none';
}
