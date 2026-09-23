import { describe, expect, it } from 'vitest';
import { isKnownSkipReasonId, SKIP_REASONS } from './skipReasons';

describe('skipReasons', () => {
  it('matches the eight reasons from B248 assets/reasons.js verbatim', () => {
    expect(SKIP_REASONS).toEqual([
      { id: 'role-family', label: 'не та семья ролей' },
      { id: 'level', label: 'не тот уровень (слишком junior / слишком старший)' },
      { id: 'geo-format', label: 'география или формат не подходят' },
      { id: 'comp-below', label: 'вилка ниже ожиданий' },
      { id: 'company', label: 'компания или индустрия не интересны' },
      { id: 'duplicate', label: 'уже откликался / дубликат' },
      { id: 'unverified', label: 'требование не подтверждено фактами' },
      { id: 'stale', label: 'вакансия выглядит устаревшей или подозрительной' },
    ]);
  });

  it('recognises known ids and rejects unknown strings', () => {
    expect(isKnownSkipReasonId('duplicate')).toBe(true);
    expect(isKnownSkipReasonId('not-a-reason')).toBe(false);
  });
});
