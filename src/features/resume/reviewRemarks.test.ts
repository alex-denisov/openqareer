import { describe, expect, it } from 'vitest';
import { reviewRemarks, type ReviewBlock } from './ProfileReviewAndVersions';

describe('reviewRemarks', () => {
  it('lists every remark behind «N замечаний», findings included (owner, 02.11)', () => {
    const block: ReviewBlock = {
      id: 'experience',
      label: 'Опыт',
      hasData: true,
      issueCount: 3,
      issues: [
        { code: 'missing-role-end-date', message: 'Нет даты окончания.' },
        { code: 'missing-role-claims', message: 'Нет результатов в цифрах.' },
      ] as unknown as ReviewBlock['issues'],
      extraRemarks: ['Размер команды неизвестен в 2 местах.'],
    };
    expect(reviewRemarks(block)).toEqual([
      'Нет даты окончания.',
      'Нет результатов в цифрах.',
      'Размер команды неизвестен в 2 местах.',
    ]);
  });
});
