import type { ResumeAtsAssessment } from '../../../server/domain/resumeAtsAssessment';

export interface AtsTotalView {
  readonly score: number | null;
  readonly maximum: number;
  readonly note: string | null;
}

const KEYWORDS_NOT_SCORED_NOTE = 'Ключевые слова не оценены: оценка по остальным разделам.';

/**
 * Итог карточки: измеренная сумма из измеренного максимума. Пока ключевые слова
 * неизвестны, пометка говорит об этом, а не прячет оценку за прочерком.
 */
export function atsTotalView(assessment: ResumeAtsAssessment | null): AtsTotalView {
  if (!assessment) return { score: null, maximum: 100, note: null };
  const { score, maximum, status } = assessment.total;
  const keywordsUnknown = assessment.dimensions.keywords.status === 'unknown';
  return {
    score,
    maximum,
    note:
      score !== null && status === 'partial' && keywordsUnknown ? KEYWORDS_NOT_SCORED_NOTE : null,
  };
}

/** Совет по ключевым словам: только реальное несовпавшее требование, иначе ничего. */
export function keywordTip(assessment: ResumeAtsAssessment | null): string | null {
  const keywords = assessment?.dimensions.keywords;
  if (!keywords || keywords.status !== 'measured') return null;
  const missing = keywords.unmatchedRequirements ?? [];
  return missing.length
    ? `Проверьте требования без точного текстового совпадения: ${missing.join(', ')}.`
    : null;
}
