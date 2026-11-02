import { describe, expect, it } from 'vitest';
import { distinctReviewIssues, reviewRemarks, type ReviewBlock } from './ProfileReviewAndVersions';

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

describe('distinctReviewIssues', () => {
  it('counts one remark once, as the list shows it (owner prod, 02.11: 12 vs 9)', () => {
    const issues = [
      { code: 'invalid-chronology-date', entryId: 'a', message: 'Проверьте дату «Nov 2025».' },
      { code: 'invalid-chronology-date', entryId: 'b', message: 'Проверьте дату «Nov 2025».' },
      { code: 'missing-role-claims', entryId: 'a', message: 'Нет результатов в цифрах.' },
    ] as unknown as ReviewBlock['issues'];
    expect(distinctReviewIssues(issues).map((issue) => issue.message)).toEqual([
      'Проверьте дату «Nov 2025».',
      'Нет результатов в цифрах.',
    ]);
  });
});
