import { describe, expect, it } from 'vitest';

import { isRoleChecked, toggleRole } from './VacancyRoleFilter';

const all = ['Head of Engineering', 'Director of Engineering', 'CTO'];
const base = { roles: [] as string[], regions: [], remoteOnly: false };

describe('roles popover selection (B547)', () => {
  it('empty selection means every campaign role', () => {
    expect(all.every((role) => isRoleChecked(base, role))).toBe(true);
  });

  it('unchecking one role keeps the others', () => {
    expect(toggleRole(base, 'CTO', all).roles).toEqual([
      'Head of Engineering',
      'Director of Engineering',
    ]);
  });

  it('checking every role again returns to «all»', () => {
    const one = toggleRole(base, 'CTO', all);
    expect(toggleRole(one, 'CTO', all).roles).toEqual([]);
  });
});
