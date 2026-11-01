import { describe, expect, it } from 'vitest';
import { evaluateVacancyFit } from './vacancyFit';
import { fitInput } from './vacancyFit.test';

describe('fit scoring after 01.11: stated counts in full, partial counts half', () => {
  it('counts matched 1 whether stated or checked, partial 0.5, unknown 0 — checked stays a label', () => {
    const input = fitInput();
    const assessments = [
      {
        requirementId: 'r1',
        status: 'matched' as const,
        evidence: [{ factId: 'f1', quote: 'TypeScript services' }],
      },
      {
        requirementId: 's2',
        status: 'partial' as const,
        evidence: [{ factId: 'f1', quote: 'Node' }],
      },
      { requirementId: 's3', status: 'unknown' as const, evidence: [] },
    ];
    const stated = evaluateVacancyFit({ ...input, checkedFactIds: [], assessments });
    expect(stated.coveragePercent).toBe(50);
    expect(stated.assessments.map((item) => item.status)).toEqual([
      'matched',
      'partial',
      'unknown',
    ]);
    expect(stated.coverage).toMatchObject({ matched: 1, partial: 1, total: 3, checked: 0 });
    const checked = evaluateVacancyFit({ ...input, assessments });
    expect(checked.coveragePercent).toBe(50);
    expect(checked.assessments[0].checked).toBe(true);
  });

  it('a fully stated profile reaches 100 %, not the old 50 % ceiling', () => {
    expect(evaluateVacancyFit({ ...fitInput(), checkedFactIds: [] }).coveragePercent).toBe(100);
  });

  it('checks the quote against the privacy-cleaned text the model saw', () => {
    const input = fitInput();
    const facts = [
      { ...input.facts[0], statement: 'TypeScript, Node and SQL; mail me@example.com' },
    ];
    const assessments = [
      {
        requirementId: 'r1',
        status: 'matched' as const,
        evidence: [{ factId: 'f1', quote: 'TypeScript, Node and SQL; mail [contact removed]' }],
      },
      {
        requirementId: 's2',
        status: 'matched' as const,
        evidence: [{ factId: 'f1', quote: 'Node' }],
      },
      {
        requirementId: 's3',
        status: 'matched' as const,
        evidence: [{ factId: 'f1', quote: 'SQL' }],
      },
    ];
    expect(evaluateVacancyFit({ ...input, facts, assessments }).assessments[0].status).toBe(
      'matched',
    );
  });
});
