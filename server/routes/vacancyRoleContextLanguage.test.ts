import { describe, expect, it } from 'vitest';
import { resolveRoleNameLanguage } from '../domain/roleNameLanguage';
import { roleLanguageRegions } from './vacancyRoleContext';

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
