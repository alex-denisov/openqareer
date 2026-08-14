import { describe, expect, it } from 'vitest';
import type { CandidateAnalysis } from '../evidence/evidenceEngine';
import {
  applyCanonicalProfileEvidence,
  buildCareerDiagnostic,
  diagnosticActionDestination,
} from './careerDiagnostic';

const partialAnalysis: CandidateAnalysis = {
  evidenceMethodVersion: 'evidence-local-v1',
  roleMethodVersion: 'role-hypotheses-local-v1',
  evidenceItems: [
    {
      id: 'ev-01',
      kind: 'responsibility',
      sourceExcerpt: 'Руководил поддержкой.',
      statement: 'Руководил поддержкой.',
      status: 'confirmed',
      userEdited: false,
    },
    {
      id: 'ev-02',
      kind: 'result',
      sourceExcerpt: 'Снизил время ответа.',
      statement: 'Снизил время ответа.',
      status: 'pending',
      userEdited: false,
    },
  ],
  questions: ['Как измерялось снижение?'],
  roleHypotheses: [],
};

describe('free career diagnostic', () => {
  it('projects dialogue memory into the evidence finding without treating it as resume proof', () => {
    const base = buildCareerDiagnostic({
      resumeText: '',
      resumeSource: 'conversation',
      sourceUpdatedAt: null,
      targetDirection: 'Руководитель продукта',
      analysis: undefined,
      marketEvidenceUpdatedAt: null,
    });

    const diagnostic = applyCanonicalProfileEvidence(base, [
      {
        id: 'proposed-result',
        kind: 'fact',
        domain: 'outcome',
        status: 'proposed',
        sourceMessageIds: ['message-1'],
      },
      {
        id: 'open-question',
        kind: 'open-question',
        domain: 'gap',
        status: 'proposed',
        sourceMessageIds: ['message-2'],
      },
    ]);

    expect(diagnostic.coverage.profileEvidence).toEqual({
      confirmed: 0,
      proposed: 1,
      openQuestions: 1,
    });
    expect(
      diagnostic.findings.find((finding) => finding.dimension === 'evidence'),
    ).toMatchObject({
      certainty: 'fact',
      status: 'issue',
      sourceRefs: ['memory:proposed-result'],
    });
    expect(
      diagnostic.findings.find((finding) => finding.dimension === 'ats'),
    ).toMatchObject({ certainty: 'unknown', status: 'unknown' });
    expect(diagnostic.nextAction).toMatchObject({
      type: 'review',
      findingIds: ['profile-evidence-review'],
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/score|балл/iu);
  });

  it('recognizes only candidate-confirmed profile outcomes as evidence strengths', () => {
    const base = buildCareerDiagnostic({
      resumeText: '',
      resumeSource: 'conversation',
      targetDirection: 'Operations Lead',
    });

    const diagnostic = applyCanonicalProfileEvidence(base, [
      {
        id: 'confirmed-result',
        kind: 'fact',
        domain: 'outcome',
        status: 'confirmed',
        sourceMessageIds: ['message-1'],
      },
      {
        id: 'confirmed-responsibility',
        kind: 'fact',
        domain: 'responsibility',
        status: 'corrected',
        sourceMessageIds: ['message-2'],
      },
    ]);

    expect(
      diagnostic.findings.find((finding) => finding.dimension === 'evidence'),
    ).toMatchObject({
      certainty: 'fact',
      status: 'strength',
      sourceRefs: ['memory:confirmed-result'],
    });
  });

  it('keeps an open question separate when the profile has no factual memory', () => {
    const base = buildCareerDiagnostic({
      resumeText: '',
      resumeSource: 'conversation',
      targetDirection: '',
    });

    const diagnostic = applyCanonicalProfileEvidence(base, [
      {
        id: 'question-only',
        kind: 'open-question',
        domain: 'gap',
        status: 'proposed',
        sourceMessageIds: ['message-1'],
      },
    ]);

    expect(diagnostic.coverage.profileEvidence).toEqual({
      confirmed: 0,
      proposed: 0,
      openQuestions: 1,
    });
    expect(
      diagnostic.findings.find((finding) => finding.dimension === 'evidence'),
    ).toMatchObject({ id: 'evidence-not-reviewed', certainty: 'unknown' });
    expect(diagnostic.nextAction.type).toBe('question');
  });

  it('routes the diagnostic correction to the surface that can perform it', () => {
    expect(diagnosticActionDestination({ type: 'question' })).toBe('today');
    expect(diagnosticActionDestination({ type: 'review' })).toBe('profile');
    expect(diagnosticActionDestination({ type: 'research' })).toBe('opportunities');
  });

  it('makes stale PDF evidence visible without inventing an ATS score', () => {
    const diagnostic = buildCareerDiagnostic(
      {
        resumeText: 'Руководил поддержкой и улучшал процессы. '.repeat(16),
        resumeSource: 'pdf',
        sourceUpdatedAt: '2023-05-01',
        targetDirection: 'Директор по операциям',
        analysis: partialAnalysis,
        marketEvidenceUpdatedAt: null,
      },
      '2026-08-07',
    );

    expect(diagnostic.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: 'freshness',
          certainty: 'fact',
          status: 'issue',
        }),
        expect.objectContaining({
          dimension: 'evidence',
          certainty: 'fact',
          status: 'issue',
          sourceRefs: ['evidence:ev-02'],
        }),
        expect.objectContaining({
          dimension: 'market',
          certainty: 'unknown',
        }),
      ]),
    );
    expect(JSON.stringify(diagnostic)).not.toMatch(/score|балл/iu);
    expect(diagnostic.nextAction.reason).toBeTruthy();
  });

  it('keeps PDF layout and cross-source contradictions unknown', () => {
    const diagnostic = buildCareerDiagnostic({
      resumeText: 'Опыт управления операциями. '.repeat(20),
      resumeSource: 'pdf',
      sourceUpdatedAt: null,
      targetDirection: 'Operations Lead',
      analysis: undefined,
      marketEvidenceUpdatedAt: null,
    });

    expect(diagnostic.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: 'ats',
          certainty: 'unknown',
          correction: expect.stringContaining('оригинал PDF'),
        }),
        expect.objectContaining({
          dimension: 'contradictions',
          certainty: 'unknown',
        }),
        expect.objectContaining({
          dimension: 'freshness',
          certainty: 'unknown',
        }),
      ]),
    );
    expect(diagnostic.nextAction.findingIds).toEqual([
      'evidence-not-reviewed',
    ]);
    expect(diagnostic.nextAction.label).toContain('предложения по одному');
  });

  it('returns an honest partial result for conversation-only input', () => {
    const diagnostic = buildCareerDiagnostic({
      resumeText: 'Кандидат рассказал об опыте запуска продукта. '.repeat(3),
      resumeSource: 'conversation',
      sourceUpdatedAt: null,
      targetDirection: '',
      analysis: undefined,
      marketEvidenceUpdatedAt: null,
    });

    expect(diagnostic.coverage).toMatchObject({
      sourceKinds: ['conversation'],
      isPartial: true,
    });
    expect(diagnostic.summary).toContain('частич');
    expect(diagnostic.nextAction.type).toBe('question');
    expect(
      diagnostic.findings.every((finding) => finding.correction.length > 0),
    ).toBe(true);
  });

  it('uses singular Russian grammar for one confirmed issue', () => {
    const diagnostic = buildCareerDiagnostic({
      resumeText: 'Руководил операциями и улучшал процессы.',
      resumeSource: 'text',
      targetDirection: 'Директор по операциям',
      analysis: {
        ...partialAnalysis,
        evidenceItems: partialAnalysis.evidenceItems.map((item) => ({
          ...item,
          status: 'confirmed' as const,
        })),
      },
      marketEvidenceUpdatedAt: '2026-08-08',
    }, '2026-08-09');

    expect(diagnostic.summary).toContain('1 подтверждённую зону');
    expect(diagnostic.summary).not.toContain('1 подтверждённые зоны');
  });
});
