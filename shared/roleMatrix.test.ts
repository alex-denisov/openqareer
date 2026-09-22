import { describe, expect, it } from 'vitest';
import { isAdminRole, roleCan } from './roleMatrix';

describe('role capability matrix', () => {
  it('keeps LinkedIn pool management admin-only', () => {
    expect(roleCan('admin', 'admin.linkedin_pool')).toBe(true);
    expect(roleCan('candidate', 'admin.linkedin_pool')).toBe(false);
    expect(roleCan('candidate', 'admin.console')).toBe(false);
    expect(isAdminRole('admin')).toBe(true);
    expect(isAdminRole('candidate')).toBe(false);
  });
});
