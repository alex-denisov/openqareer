import { describe, expect, it } from 'vitest';
import { isKnownSkipReasonId, SKIP_REASONS } from './skipReasons';

describe('skipReasons', () => {
  it('matches the eight reasons from B248 assets/reasons.js verbatim, with a matching impact', () => {
    expect(SKIP_REASONS).toEqual([
      { id: 'role-family', label: 'не та семья ролей', matchingImpact: 'lower_similar' },
      {
        id: 'level',
        label: 'не тот уровень (слишком junior / слишком старший)',
        matchingImpact: 'lower_similar',
      },
      {
        id: 'geo-format',
        label: 'география или формат не подходят',
        matchingImpact: 'lower_similar',
      },
      { id: 'comp-below', label: 'вилка ниже ожиданий', matchingImpact: 'lower_similar' },
      {
        id: 'company',
        label: 'компания или индустрия не интересны',
        matchingImpact: 'lower_similar',
      },
      { id: 'duplicate', label: 'уже откликался / дубликат', matchingImpact: 'none' },
      { id: 'unverified', label: 'требование не подтверждено фактами', matchingImpact: 'none' },
      {
        id: 'stale',
        label: 'вакансия выглядит устаревшей или подозрительной',
        matchingImpact: 'none',
      },
    ]);
  });

  it('recognises known ids and rejects unknown strings', () => {
    expect(isKnownSkipReasonId('duplicate')).toBe(true);
    expect(isKnownSkipReasonId('not-a-reason')).toBe(false);
  });

  it('only lowers similar vacancies for taste reasons, not data-quality ones', () => {
    const dataQualityReasons = ['duplicate', 'unverified', 'stale'];
    for (const reason of SKIP_REASONS) {
      const expected = dataQualityReasons.includes(reason.id) ? 'none' : 'lower_similar';
      expect(reason.matchingImpact).toBe(expected);
    }
  });
});
