import { describe, expect, it } from 'vitest';
import type { ResumeAtsAssessment } from '../../../server/domain/resumeAtsAssessment';
import { atsTotalView, keywordTip } from './atsTotal';

function assessment(overrides: {
  total?: Partial<ResumeAtsAssessment['total']>;
  keywords?: Partial<ResumeAtsAssessment['dimensions']['keywords']>;
}): ResumeAtsAssessment {
  return {
    total: { score: 65, maximum: 70, status: 'partial', ...overrides.total },
    dimensions: {
      keywords: {
        score: null,
        maximum: 30,
        status: 'unknown',
        source: 's',
        sampleSize: 0,
        summary: 'Недостаточно требований для оценки: нужно хотя бы 3, сейчас 1.',
        unmatchedRequirements: [],
        ...overrides.keywords,
      },
    },
    context: { requirementSource: null },
  } as unknown as ResumeAtsAssessment;
}

describe('atsTotalView', () => {
  it('shows the measured sum over the measured maximum with a note when keywords are unknown', () => {
    expect(atsTotalView(assessment({}))).toEqual({
      score: 65,
      maximum: 70,
      note: 'Ключевые слова не оценены: оценка по остальным разделам.',
    });
  });

  it('has no note when everything is measured', () => {
    const view = atsTotalView(
      assessment({ total: { score: 80, maximum: 100, status: 'measured' } }),
    );
    expect(view).toEqual({ score: 80, maximum: 100, note: null });
  });

  it('is empty without an assessment or a score', () => {
    expect(atsTotalView(null)).toEqual({ score: null, maximum: 100, note: null });
    expect(atsTotalView(assessment({ total: { score: null, maximum: 100, status: 'unknown' } })).score).toBeNull();
  });
});

describe('keywordTip', () => {
  it('never turns the insufficient-sample sentence into a tip', () => {
    expect(keywordTip(assessment({ keywords: { unmatchedRequirements: ['Kafka'] } }))).toBeNull();
    expect(keywordTip(assessment({}))).toBeNull();
  });

  it('names real unmatched requirements of a measured dimension', () => {
    const tip = keywordTip(
      assessment({
        keywords: { status: 'measured', score: 10, unmatchedRequirements: ['Kafka', 'Terraform'] },
      }),
    );
    expect(tip).toBe('Проверьте требования без точного текстового совпадения: Kafka, Terraform.');
  });

  it('is empty when every requirement matched', () => {
    expect(
      keywordTip(assessment({ keywords: { status: 'measured', score: 30, unmatchedRequirements: [] } })),
    ).toBeNull();
  });
});
