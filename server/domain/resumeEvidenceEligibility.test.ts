import { describe, expect, it } from 'vitest';
import {
  isResumeEvidenceEligible,
  resumeEvidenceIneligibilityReason,
  type ResumeEvidenceCandidate,
} from './resumeEvidenceEligibility';

function evidence(
  overrides: Partial<ResumeEvidenceCandidate> = {},
): ResumeEvidenceCandidate {
  return {
    id: 'memory-1',
    kind: 'fact',
    status: 'confirmed',
    statement: 'Сократил подготовку отчётности с 2 дней до 20 минут.',
    sourceMessageIds: ['message-1'],
    sensitive: false,
    ...overrides,
  };
}

describe('resume evidence eligibility', () => {
  it('accepts a confirmed non-sensitive fact with provenance', () => {
    expect(isResumeEvidenceEligible(evidence())).toBe(true);
    expect(resumeEvidenceIneligibilityReason(evidence())).toBeNull();
  });

  it('accepts a corrected fact, because a correction is still candidate-owned truth', () => {
    expect(isResumeEvidenceEligible(evidence({ status: 'corrected' }))).toBe(true);
  });

  it('refuses a proposed memory the candidate has not confirmed', () => {
    const proposed = evidence({ status: 'proposed' });
    expect(isResumeEvidenceEligible(proposed)).toBe(false);
    expect(resumeEvidenceIneligibilityReason(proposed)).toBe('not-confirmed');
  });

  it('refuses a hypothesis, so a vacancy-derived guess cannot become a bullet', () => {
    const hypothesis = evidence({ kind: 'hypothesis' });
    expect(isResumeEvidenceEligible(hypothesis)).toBe(false);
    expect(resumeEvidenceIneligibilityReason(hypothesis)).toBe('not-a-fact');
  });

  it('refuses sensitive material regardless of confirmation', () => {
    const sensitive = evidence({ sensitive: true });
    expect(isResumeEvidenceEligible(sensitive)).toBe(false);
    expect(resumeEvidenceIneligibilityReason(sensitive)).toBe('sensitive');
  });

  it('refuses a claim with no source message to trace it back to', () => {
    const orphan = evidence({ sourceMessageIds: [] });
    expect(isResumeEvidenceEligible(orphan)).toBe(false);
    expect(resumeEvidenceIneligibilityReason(orphan)).toBe('no-provenance');
  });

  it('refuses an empty identifier or statement', () => {
    expect(isResumeEvidenceEligible(evidence({ id: '' }))).toBe(false);
    expect(isResumeEvidenceEligible(evidence({ statement: '  ' }))).toBe(false);
    expect(resumeEvidenceIneligibilityReason(evidence({ statement: '  ' }))).toBe(
      'empty',
    );
  });
});
