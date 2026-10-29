import type { FastifyBaseLogger } from 'fastify';
import type { RecruiterContact } from '../../shared/recruiterContact';
import {
  canonicalLinkedInProfile,
  type NetworkObservation,
} from '../data/sqliteNetworkIndexRepository';
import {
  candidateCompanyKey,
  type PlatformMember,
  type PlatformMembers,
} from '../domain/candidateCompanies';
import type { RouteDeps } from './deps';

/**
 * B561: what the routes put into the shared network index and read back. Owner 30.10:
 * platform members are 1st circle to each other, so every member with LinkedIn
 * connected takes part — the platform agreement and LinkedIn's own are enough. The
 * candidate sees the members by name with a LinkedIn link; contact happens only there.
 */
type NetworkDeps = Pick<RouteDeps, 'networkIndexRepo' | 'candidateStore' | 'recruiterContactsRepo'>;

interface StoredConnectionPlace {
  readonly companySource?: 'headline' | 'search';
}

type ReadPlace = (record: RecruiterContact) => StoredConnectionPlace | null;
type ErrorLog = Pick<FastifyBaseLogger, 'error'>;

/**
 * A circle lists only so many (each listed member costs a profile read); the count stays
 * exact. Security review 30.10: synchronous reads here must stay small.
 */
const MAX_LISTED_MEMBERS = 10;

type ConnectionLookup =
  | { readonly state: 'connected'; readonly sourceUrl: string }
  | { readonly state: 'absent' }
  | { readonly state: 'unknown' };

function linkedinConnection(deps: NetworkDeps, candidateId: string): ConnectionLookup {
  try {
    const connection = deps.candidateStore
      .listNativeSourceConnections(candidateId)
      .find((item) => item.platform === 'linkedin');
    return connection
      ? { state: 'connected', sourceUrl: connection.receipt.sourceUrl }
      : { state: 'absent' };
  } catch {
    // A failed read is not "disconnected": nothing is removed on it.
    return { state: 'unknown' };
  }
}

export function memberHasLinkedIn(deps: NetworkDeps, candidateId: string): boolean {
  return linkedinConnection(deps, candidateId).state === 'connected';
}

/** Only a member found without LinkedIn loses edges; an unknown state keeps them. */
function memberMayStay(deps: NetworkDeps, candidateId: string): boolean {
  return linkedinConnection(deps, candidateId).state !== 'absent';
}

/**
 * The member's stored LinkedIn connections become the full set of their edges.
 * It runs after the caller's own write is saved, so a failure is logged, not thrown.
 */
export function syncMemberNetwork(
  deps: NetworkDeps,
  candidateId: string,
  records: readonly RecruiterContact[],
  readPlace: ReadPlace,
  log: ErrorLog,
): void {
  try {
    replaceMemberNetwork(deps, candidateId, records, readPlace);
  } catch (error) {
    log.error({ err: error }, 'b561 network index sync failed');
  }
}

/** Contacts read before members fed the index join it the first time they are opened. */
export function ensureMemberNetwork(
  deps: NetworkDeps,
  candidateId: string,
  records: readonly RecruiterContact[],
  readPlace: ReadPlace,
  log: ErrorLog,
): void {
  const hasConnections = records.some(
    (record) => record.sourceType === 'candidate_linkedin_connection' && record.linkedinUrl,
  );
  if (!deps.networkIndexRepo || !hasConnections) return;
  try {
    if (deps.networkIndexRepo.memberEdgeCount(candidateId) > 0) return;
  } catch (error) {
    log.error({ err: error }, 'b561 network index read failed');
    return;
  }
  syncMemberNetwork(deps, candidateId, records, readPlace, log);
}

function replaceMemberNetwork(
  deps: NetworkDeps,
  candidateId: string,
  records: readonly RecruiterContact[],
  readPlace: ReadPlace,
): void {
  if (!deps.networkIndexRepo || !memberHasLinkedIn(deps, candidateId)) return;
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
  log: ErrorLog,
): void {
  if (!deps.networkIndexRepo || !memberHasLinkedIn(deps, candidateId)) return;
  try {
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
  } catch (error) {
    log.error({ err: error }, 'b561 network index search write failed');
  }
}

/** LinkedIn disconnected or the account deleted: the member's edges go. */
export function forgetMemberNetwork(deps: NetworkDeps, candidateId: string, log: ErrorLog): void {
  try {
    deps.networkIndexRepo?.deleteMemberEdges(candidateId);
  } catch (error) {
    log.error({ err: error }, 'b561 network index delete failed');
  }
}

/**
 * Circle 2: the other members who know someone at the company now — each once —
 * with their name, their LinkedIn and one person there. Never e-mail or phone.
 * Members are 1st circle to each other, so the viewer needs LinkedIn connected too.
 * A failure here leaves circle 2 without members instead of failing the circles.
 */
export function platformMembersAt(
  deps: NetworkDeps,
  candidateId: string,
  companyName: string,
  log: ErrorLog,
): PlatformMembers {
  const name = companyName.trim();
  if (!deps.networkIndexRepo || !name || !memberHasLinkedIn(deps, candidateId)) return NO_MEMBERS;
  try {
    const repo = deps.networkIndexRepo;
    const companyKey = candidateCompanyKey(name);
    const listed = repo.membersWithPathsInto(
      companyKey,
      candidateId,
      (id) => memberMayStay(deps, id),
      new Date(),
      MAX_LISTED_MEMBERS,
    );
    const members = listed.flatMap((memberId) => platformMember(deps, memberId, companyKey) ?? []);
    return { count: repo.memberCountInto(companyKey, candidateId), members };
  } catch (error) {
    log.error({ err: error }, 'b561 platform members read failed');
    return NO_MEMBERS;
  }
}

const NO_MEMBERS: PlatformMembers = { count: 0, members: [] };

function platformMember(
  deps: NetworkDeps,
  memberId: string,
  companyKey: string,
): PlatformMember | null {
  const personName = firstPersonAt(deps, memberId, companyKey);
  if (!personName) return null;
  let candidate: { fullName?: string; contact?: { linkedinUrl?: string } } = {};
  try {
    candidate = deps.candidateStore.getSnapshot(memberId).resume?.draft.candidate ?? {};
  } catch {
    candidate = {};
  }
  // The connected account's own address first: a profile field is self-declared.
  const connection = linkedinConnection(deps, memberId);
  const connected =
    connection.state === 'connected' ? canonicalLinkedInProfile(connection.sourceUrl) : null;
  const declared = candidate.contact?.linkedinUrl
    ? canonicalLinkedInProfile(candidate.contact.linkedinUrl)
    : null;
  return {
    fullName: candidate.fullName?.trim().slice(0, 120) || 'Участник OpenQareer',
    linkedinUrl: connected ?? declared,
    personName,
  };
}

/** One person the member knows at the company, named from the member's own list. */
function firstPersonAt(deps: NetworkDeps, memberId: string, companyKey: string): string | null {
  if (!deps.networkIndexRepo || !deps.recruiterContactsRepo) return null;
  for (const profile of deps.networkIndexRepo.memberProfilesAt(memberId, companyKey)) {
    const slug = decodeURIComponent(new URL(profile).pathname.split('/')[2] ?? '');
    if (!slug) continue;
    const name = deps.recruiterContactsRepo.findConnectionNameBySlug(
      memberId,
      CONNECTION_SCOPE_ID,
      slug,
    );
    if (name?.trim()) return name.trim().slice(0, 120);
  }
  return null;
}

/** The scope the candidate's connection contacts are stored under (B448). */
export const CONNECTION_SCOPE_ID = '__b448_candidate_connections__';
