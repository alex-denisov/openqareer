import { describe, expect, it } from 'vitest';
import {
  evaluateProductCase,
  evaluateWorkPreferences,
  productCaseSubmissionSchema,
  workPreferenceSubmissionSchema,
} from './assessment';

describe('role assessment domain', () => {
  it('routes self-reported work preferences with visible weighted evidence', () => {
    const result = evaluateWorkPreferences(
      workPreferenceSubmissionSchema.parse({
        ambiguity: 5,
        evidence: 5,
        collaboration: 4,
        persuasion: 2,
        planning: 3,
        detail: 2,
        leadership: 3,
        craft: 4,
      }),
    );

    expect(result.kind).toBe('work-preferences');
    expect(result.roleFamilies[0].id).toBe('product-discovery');
    expect(result.roleFamilies[0].contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: 'ambiguity',
          answer: 5,
          weight: 2,
        }),
      ]),
    );
    expect(result.caveat).toMatch(/самоотчёт/i);
  });

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
