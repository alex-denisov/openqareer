import { describe, expect, it } from 'vitest';
import type { CandidateAnalysis } from '../evidence/evidenceEngine';
import { buildCareerDiagnostic } from './careerDiagnostic';

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
});
