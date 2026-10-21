import type { DatabaseSync } from 'node:sqlite';
import type { CareerPartnerCandidate, CareerPartnerCandidatePage, AuthPrincipal } from '../auth/authTypes';
import { getUser, recordAdminAudit } from '../auth/adminUserManager';

interface CandidateAssignmentRow {
  user_id: string;
  candidate_id: string;
  display_name: string | null;
  headline: string | null;
  location: string | null;
}

const ASSIGNED_CANDIDATE_FROM = `
  FROM career_partner_assignments assignment
  JOIN users partner ON partner.id = assignment.partner_user_id
    AND COALESCE(partner.role_override, partner.role) = 'CareerPartner'
  JOIN users candidate ON candidate.id = assignment.candidate_user_id
    AND candidate.role = 'candidate' AND candidate.candidate_id IS NOT NULL
    AND candidate.blocked_at IS NULL
  WHERE assignment.partner_user_id = ?
`;

function toCandidate(row: CandidateAssignmentRow): CareerPartnerCandidate {
  return {
    userId: row.user_id,
    candidateId: row.candidate_id,
    displayName: row.display_name,
    headline: row.headline,
    location: row.location,
  };
}

export function listCareerPartnerCandidates(
  database: DatabaseSync,
  partnerUserId: string,
  limit = 20,
  offset = 0,
): CareerPartnerCandidatePage {
  const total = database.prepare(
    `SELECT COUNT(*) AS total ${ASSIGNED_CANDIDATE_FROM}`,
  ).get(partnerUserId) as { total: number };
  const rows = database.prepare(
    `SELECT candidate.id AS user_id, candidate.candidate_id, candidate.display_name,
       candidate.headline, candidate.location ${ASSIGNED_CANDIDATE_FROM}
     ORDER BY COALESCE(candidate.display_name, candidate.username) COLLATE NOCASE, candidate.id
     LIMIT ? OFFSET ?`,
  ).all(partnerUserId, limit, offset) as unknown as CandidateAssignmentRow[];
  const items = rows.map(toCandidate);
  return {
    total: total.total,
    items,
    nextOffset: offset + items.length < total.total ? offset + items.length : null,
  };
}

export function getAssignedCareerPartnerCandidate(
  database: DatabaseSync,
  partnerUserId: string,
  candidateUserId: string,
): CareerPartnerCandidate | null {
  const row = database.prepare(
    `SELECT candidate.id AS user_id, candidate.candidate_id, candidate.display_name,
       candidate.headline, candidate.location ${ASSIGNED_CANDIDATE_FROM}
       AND candidate.id = ?`,
  ).get(partnerUserId, candidateUserId) as CandidateAssignmentRow | undefined;
  return row ? toCandidate(row) : null;
}

function getValidAssignmentUsers(database: DatabaseSync, partnerUserId: string, candidateUserId: string) {
  const partner = getUser(database, partnerUserId);
  const candidate = getUser(database, candidateUserId);
  if (
    partner?.role !== 'CareerPartner' ||
    partner.blockedAt ||
    candidate?.role !== 'candidate' ||
    candidate.blockedAt ||
    !candidate.candidateId
  ) {
    throw new Error('Партнёр или кандидат не найден.');
  }
  return { partner, candidate };
}

export function assignCandidateToPartner(
  database: DatabaseSync,
  partnerUserId: string,
  candidateUserId: string,
  actorPrincipal: AuthPrincipal,
): boolean {
  const { partner, candidate } = getValidAssignmentUsers(database, partnerUserId, candidateUserId);
  const result = database.prepare(
    `INSERT OR IGNORE INTO career_partner_assignments
      (partner_user_id, candidate_user_id, created_at) VALUES (?, ?, ?)`,
  ).run(partner.id, candidate.id, new Date().toISOString());
  if (result.changes > 0) recordAssignmentAudit(database, actorPrincipal, partner, candidate, true);
  return result.changes > 0;
}

export function removeCandidateFromPartner(
  database: DatabaseSync,
  partnerUserId: string,
  candidateUserId: string,
  actorPrincipal: AuthPrincipal,
): boolean {
  const { partner, candidate } = getValidAssignmentUsers(database, partnerUserId, candidateUserId);
  const result = database.prepare(
    'DELETE FROM career_partner_assignments WHERE partner_user_id = ? AND candidate_user_id = ?',
  ).run(partner.id, candidate.id);
  if (result.changes > 0) recordAssignmentAudit(database, actorPrincipal, partner, candidate, false);
  return result.changes > 0;
}

function recordAssignmentAudit(
  database: DatabaseSync,
  actor: AuthPrincipal,
  partner: { id: string; username: string },
  candidate: { id: string; username: string },
  assigned: boolean,
): void {
  recordAdminAudit(database, {
    actorUserId: actor.userId,
    actorUsername: actor.username,
    action: assigned ? 'assign_candidate_to_partner' : 'unassign_candidate_from_partner',
    subjectUserId: candidate.id,
    subjectUsername: candidate.username,
    detail: JSON.stringify({ partnerUserId: partner.id }),
  });
}
