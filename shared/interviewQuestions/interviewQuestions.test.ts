import { describe, expect, it } from 'vitest';
import {
  INTERVIEW_EVIDENCE,
  INTERVIEW_OPEN_QUESTIONS,
  INTERVIEW_PROFESSIONS,
  INTERVIEW_QUIZ_LENGTH,
  interviewProfessionIndexable,
  interviewProfessionPublished,
  type InterviewProfession,
} from '.';

describe('B568 interview question bank', () => {
  it.each(INTERVIEW_PROFESSIONS.map((row) => [row.slug, row] as const))(
    '%s is complete and grounded in the pool measurement',
    (_slug, profession) => {
      const ids = profession.questions.map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(profession.questions.length).toBeGreaterThan(INTERVIEW_OPEN_QUESTIONS);
      expect(profession.quiz).toHaveLength(INTERVIEW_QUIZ_LENGTH);
      for (const item of profession.quiz) {
        expect(item.correct).toBeGreaterThanOrEqual(0);
        expect(item.correct).toBeLessThan(item.options.length);
      }
      for (const row of profession.questions) {
        expect(row.checks.trim()).not.toBe('');
        expect(row.strong.trim()).not.toBe('');
        if (row.topic) expect(() => new RegExp(row.topic!.pattern, 'iu')).not.toThrow();
      }
      const evidence = INTERVIEW_EVIDENCE.professions[profession.slug];
      expect(evidence?.described).toBeGreaterThanOrEqual(INTERVIEW_EVIDENCE.minDescribed);
      expect(interviewProfessionPublished(profession)).toBe(true);
    },
  );

  it('keeps a profession without a measured sample unpublished', () => {
    const draft: InterviewProfession = { ...INTERVIEW_PROFESSIONS[0]!, slug: 'not-measured' };
    expect(interviewProfessionPublished(draft)).toBe(false);
  });

  it('keeps an unread profession out of the index', () => {
    const { reviewedAt: _read, ...unread } = INTERVIEW_PROFESSIONS[0]!;
    expect(interviewProfessionPublished(unread)).toBe(true);
    expect(interviewProfessionIndexable(unread)).toBe(false);
  });
});
