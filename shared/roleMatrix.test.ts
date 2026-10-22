import { describe, expect, it } from 'vitest';
import {
  ADMIN_PERMISSION_KEYS,
  isAdminRole,
  isCareerPartnerRole,
  resolveAdminPermissions,
  roleCan,
} from './roleMatrix';

describe('role capability matrix', () => {
  it('keeps LinkedIn pool management admin-only', () => {
    expect(roleCan('admin', 'admin.linkedin_pool')).toBe(true);
    expect(roleCan('candidate', 'admin.linkedin_pool')).toBe(false);
    expect(roleCan('candidate', 'admin.console')).toBe(false);
    expect(isAdminRole('admin')).toBe(true);
    expect(isAdminRole('candidate')).toBe(false);
  });

  it('gives CareerPartner candidate access without administrative defaults', () => {
    expect(isCareerPartnerRole('CareerPartner')).toBe(true);
    expect(roleCan('CareerPartner', 'admin.console')).toBe(false);
    expect(resolveAdminPermissions('CareerPartner')).toEqual({
      can_view_candidates: true,
      can_edit_campaigns: false,
      can_manage_pool: false,
      can_view_audit: false,
    });
  });

  it('preserves existing admin access and lets explicit user values override defaults', () => {
    expect(Object.values(resolveAdminPermissions('admin'))).toEqual(
      ADMIN_PERMISSION_KEYS.map(() => true),
    );
    expect(resolveAdminPermissions('CareerPartner', { can_view_audit: true })).toMatchObject({
      can_view_candidates: true,
      can_view_audit: true,
      can_manage_pool: false,
    });
  });
});
