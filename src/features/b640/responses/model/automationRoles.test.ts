import { describe, expect, it } from 'vitest';
import { automationRoleOptions } from './automationRoles';

describe('automationRoleOptions (a04e)', () => {
  it('роли правил и роли поиска без повторов, с русским названием', () => {
    expect(
      automationRoleOptions(['CTO'], ['cto', 'Head of Engineering'], {
        'Head of Engineering': 'Руководитель разработки',
      }),
    ).toEqual([
      { value: 'CTO', label: 'CTO' },
      { value: 'Head of Engineering', label: 'Руководитель разработки' },
    ]);
  });

  it('правил ещё нет — роли поиска всё равно можно выбрать', () => {
    expect(automationRoleOptions([], ['CTO'])).toEqual([{ value: 'CTO', label: 'CTO' }]);
  });
});
