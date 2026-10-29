import type { RecruiterContact } from '../../shared/recruiterContact';
import type { NetworkObservation } from '../data/sqliteNetworkIndexRepository';
import { candidateCompanyKey } from '../domain/candidateCompanies';
import type { FastifyBaseLogger } from 'fastify';
import type { RouteDeps } from './deps';

/**
 * B561 slice 2: what the routes put into the shared network index and read back.
 * Every write happens only while the member's `linkedin_contacts` consent is active;
 * every read re-checks the consent of the members it counts.
 */
type NetworkDeps = Pick<
  RouteDeps,
  'networkIndexRepo' | 'capabilityConsentStore' | 'referralRequestRepo'
>;

interface StoredConnectionPlace {
  readonly companySource?: 'headline' | 'search';
}

export function memberSharesContacts(deps: NetworkDeps, candidateId: string): boolean {
  return (
    deps.capabilityConsentStore?.hasActiveConsentForCandidate(candidateId, 'linkedin_contacts') ??
    false
  );
}

/**
 * The member's stored LinkedIn connections become the full set of their edges.
 * It runs after the caller's own write is saved, so a failure is logged, not thrown.
 */
export function syncMemberNetwork(
  deps: NetworkDeps,
  candidateId: string,
  records: readonly RecruiterContact[],
  readPlace: (record: RecruiterContact) => StoredConnectionPlace | null,
  log: Pick<FastifyBaseLogger, 'error'>,
): void {
  try {
    replaceMemberNetwork(deps, candidateId, records, readPlace);
  } catch (error) {
    log.error({ err: error }, 'b561 network index sync failed');
  }
}

function replaceMemberNetwork(
  deps: NetworkDeps,
  candidateId: string,
  records: readonly RecruiterContact[],
  readPlace: (record: RecruiterContact) => StoredConnectionPlace | null,
): void {
  if (!deps.networkIndexRepo || !memberSharesContacts(deps, candidateId)) return;
  const observations = records.flatMap((record): NetworkObservation[] => {
    if (record.sourceType !== 'candidate_linkedin_connection' || !record.linkedinUrl) return [];
    const place = readPlace(record);
    if (!place) return [];
    return [
      {
        profileUrl: record.linkedinUrl,
        companyName: record.companyName,
        roleTitle: record.roleTitle,
        source: place.companySource === 'search' ? 'search' : 'connections',
        // The edge is confirmed when the list was read, whenever the company was.
        observedAt: record.updatedAt,
      },
    ];
  });
  deps.networkIndexRepo.replaceMemberEdges(candidateId, observations);
}

/** People a company search found in the member's 1st circle. */
export function recordSearchedNetwork(
  deps: NetworkDeps,
  candidateId: string,
  people: ReadonlyArray<{ linkedinUrl: string; companyName: string; roleTitle: string }>,
  observedAt: string,
): void {
  if (!deps.networkIndexRepo || !memberSharesContacts(deps, candidateId)) return;
  deps.networkIndexRepo.recordObservations(
    candidateId,
    people.map((person) => ({
      profileUrl: person.linkedinUrl,
      companyName: person.companyName,
      roleTitle: person.roleTitle,
      source: 'search',
      observedAt,
    })),
  );
}

/** Consent revoked: the edges go, and so does every request the member was asked. */
export function forgetMemberNetwork(deps: NetworkDeps, candidateId: string): void {
  deps.networkIndexRepo?.deleteMemberEdges(candidateId);
  deps.referralRequestRepo?.withdrawForMember(candidateId, new Date().toISOString());
}

/** Circle 2: how many paths into the company go through other consenting members. */
export function platformPathsInto(
  deps: NetworkDeps,
  candidateId: string,
  companyName: string,
): { readonly paths: number } {
  const name = companyName.trim();
  if (!deps.networkIndexRepo || !name) return { paths: 0 };
  const counted = deps.networkIndexRepo.countPlatformPaths(
    candidateCompanyKey(name),
    candidateId,
    (memberId) => memberSharesContacts(deps, memberId),
  );
  return { paths: counted.paths };
}
