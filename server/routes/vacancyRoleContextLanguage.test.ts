import { describe, expect, it } from 'vitest';
import { resolveRoleNameLanguage } from '../domain/roleNameLanguage';
import { roleLanguageRegions, withCheckedRoleAliases } from './vacancyRoleContext';

describe('язык названий ролей (29.10)', () => {
  const campaign = (regions: string[], suggestedRegions?: string[]) => ({
    regions: { value: regions, origin: 'explicit' as const },
    ...(suggestedRegions ? { suggestedRegions } : {}),
  });

  it('без регионов кампании язык решает регион из города профиля: руководитель из России — по-русски', () => {
    const regions = roleLanguageRegions(campaign([], ['ru']));
    expect(regions).toEqual(['ru']);
    expect(
      resolveRoleNameLanguage({ searchRegions: regions, targetRoles: ['Chief Operating Officer'] })
        .language,
    ).toBe('ru');
  });

  it('явные регионы кампании важнее города профиля', () => {
    expect(roleLanguageRegions(campaign(['eu'], ['ru']))).toEqual(['eu']);
  });

  it('без регионов и без города — прежнее правило', () => {
    expect(roleLanguageRegions(campaign([]))).toEqual([]);
  });
});

describe('проверка навыков под прежним названием роли (29.10)', () => {
  const role = (title: string, aliases?: string[]) =>
    ({
      id: title,
      title,
      origin: 'model',
      reason: 'r',
      evidenceRefs: [],
      confirmation: { state: 'not-found' },
      ...(aliases ? { aliases } : {}),
    }) as never;

  it('название пройденной проверки становится синонимом роли той же функции и уровня', () => {
    const [coo, cto] = withCheckedRoleAliases(
      [role('Операционный директор', ['Операционный директор']), role('Технический директор')],
      ['Операционный директор (COO)'],
    ) as Array<{ aliases?: string[] }>;
    expect(coo.aliases).toContain('Операционный директор (COO)');
    expect(cto.aliases ?? []).not.toContain('Операционный директор (COO)');
  });
});
