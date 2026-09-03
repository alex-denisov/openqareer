import { describe, expect, it } from 'vitest';
import { evaluateProductCase, productCaseSubmissionSchema } from './assessment';

describe('role assessment domain', () => {
  it('evaluates a Product/PM case against an inspectable rubric without fit claims', () => {
    const result = evaluateProductCase(
      productCaseSubmissionSchema.parse({
        firstMove: 'segment-funnel-and-interviews',
        priorityRule: 'reversible-test-biggest-uncertainty',
        successMeasure: 'activation-by-segment-with-guardrail',
        rationale:
          'Сначала проверю, где именно падает активация, и не ухудшу retention.',
      }),
    );

    expect(result.kind).toBe('product-case');
    expect(result.demonstratedSignals).toHaveLength(3);
    expect(result.rubric).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          criterion: 'problem-framing',
          points: 2,
          maxPoints: 2,
        }),
      ]),
    );
    expect(result.summary).not.toMatch(/подходите|не подходите|нанят/i);
  });

  it('keeps weak case choices as open questions rather than a rejection', () => {
    const result = evaluateProductCase({
      firstMove: 'ship-largest-client-request',
      priorityRule: 'loudest-stakeholder',
      successMeasure: 'features-shipped',
      rationale: '',
    });

    expect(result.demonstratedSignals).toEqual([]);
    expect(result.openQuestions).toHaveLength(3);
    expect(result.summary).toMatch(/не показал/i);
  });
});
