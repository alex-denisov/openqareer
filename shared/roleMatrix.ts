export type ProductRole = 'candidate' | 'admin';

export type RoleCapability =
  | 'candidate.workspace'
  | 'admin.console'
  | 'admin.linkedin_pool';

const CAPABILITIES_BY_ROLE: Record<ProductRole, readonly RoleCapability[]> = {
  candidate: ['candidate.workspace'],
  admin: ['admin.console', 'admin.linkedin_pool'],
};

export function roleCan(role: ProductRole, capability: RoleCapability): boolean {
  return CAPABILITIES_BY_ROLE[role].includes(capability);
}
export function isAdminRole(role: ProductRole | null | undefined): role is 'admin' {
  return role === 'admin';
}
