import type { DatabaseSync } from 'node:sqlite';
import type { AdminPermission } from '../../shared/roleMatrix';
import type { AuthPrincipal } from './authTypes';
import {
  assignCandidateToPartner,
  getAssignedCareerPartnerCandidate,
  listCareerPartnerCandidates,
  removeCandidateFromPartner,
} from '../admin/partnerAssignments';
import { getAdminPermissionSnapshot, setAdminPermission } from './adminUserManager';

export function createAdminAccessMethods(database: DatabaseSync) {
  return {
    getAdminPermissionSnapshot: (userId: string) => getAdminPermissionSnapshot(database, userId),
    setAdminPermission: (
      targetUserId: string,
      permission: AdminPermission,
      enabled: boolean,
      actorPrincipal: AuthPrincipal,
    ) => setAdminPermission(database, targetUserId, permission, enabled, actorPrincipal),
    listCareerPartnerCandidates: (partnerUserId: string, limit: number, offset: number) =>
      listCareerPartnerCandidates(database, partnerUserId, limit, offset),
    getAssignedCareerPartnerCandidate: (partnerUserId: string, candidateUserId: string) =>
      getAssignedCareerPartnerCandidate(database, partnerUserId, candidateUserId),
    assignCandidateToPartner: (
      partnerUserId: string,
      candidateUserId: string,
      actorPrincipal: AuthPrincipal,
    ) => assignCandidateToPartner(database, partnerUserId, candidateUserId, actorPrincipal),
    removeCandidateFromPartner: (
      partnerUserId: string,
      candidateUserId: string,
      actorPrincipal: AuthPrincipal,
    ) => removeCandidateFromPartner(database, partnerUserId, candidateUserId, actorPrincipal),
  };
}
