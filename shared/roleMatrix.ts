export type ProductRole = 'candidate' | 'admin' | 'CareerPartner';

export const ADMIN_PERMISSION_KEYS = [
  'can_view_candidates',
  'can_edit_campaigns',
  'can_manage_pool',
  'can_view_audit',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSION_KEYS)[number];
export type AdminPermissionOverrides = Readonly<Partial<Record<AdminPermission, boolean>>>;
export type AdminPermissions = Readonly<Record<AdminPermission, boolean>>;

export type RoleCapability =
  | 'candidate.workspace'
  | 'admin.console'
  | 'admin.linkedin_pool';

const CAPABILITIES_BY_ROLE: Record<ProductRole, readonly RoleCapability[]> = {
  candidate: ['candidate.workspace'],
  admin: ['admin.console', 'admin.linkedin_pool'],
  CareerPartner: [],
};

export const DEFAULT_ADMIN_PERMISSIONS: Readonly<Record<ProductRole, AdminPermissions>> = {
  candidate: {
    can_view_candidates: false,
    can_edit_campaigns: false,
    can_manage_pool: false,
    can_view_audit: false,
  },
  admin: {
    can_view_candidates: true,
    can_edit_campaigns: true,
    can_manage_pool: true,
    can_view_audit: true,
  },
  CareerPartner: {
    can_view_candidates: true,
    can_edit_campaigns: false,
    can_manage_pool: false,
    can_view_audit: false,
  },
};

export function resolveAdminPermissions(
  role: ProductRole,
  overrides: AdminPermissionOverrides = {},
): AdminPermissions {
  return { ...DEFAULT_ADMIN_PERMISSIONS[role], ...overrides };
}

export function roleCan(role: ProductRole, capability: RoleCapability): boolean {
  return CAPABILITIES_BY_ROLE[role].includes(capability);
}
export function isAdminRole(role: ProductRole | null | undefined): role is 'admin' {
  return role === 'admin';
}

export function isCareerPartnerRole(
  role: ProductRole | null | undefined,
): role is 'CareerPartner' {
  return role === 'CareerPartner';
}
