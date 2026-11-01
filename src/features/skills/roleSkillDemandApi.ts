import { apiFetch, readDataObject } from '../coach/apiClient';
import type { RoleSkillDemand } from '../../../server/domain/roleSkillDemand';

export type { RoleSkillDemand };

/** `pending`: the summary is being computed in the background; ask again shortly (B591). */
export interface RoleSkillDemandResponse {
  readonly state: 'ready' | 'pending';
  readonly roles: readonly RoleSkillDemand[];
}

export async function getRoleSkillDemand(): Promise<RoleSkillDemandResponse> {
  const response = await apiFetch('/api/v1/candidate/role-skill-demand');
  return readDataObject<RoleSkillDemandResponse>(response);
}
