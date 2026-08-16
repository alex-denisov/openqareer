import type {
  ResumeReviewFlag,
  ResumeVariantId,
  StaleEvidenceReason,
} from './resumeTypes';

export const VARIANT_LABELS: Record<ResumeVariantId, string> = {
  master: 'Мастер-резюме',
  germany: 'Германия',
};

export const VARIANT_SHORT_LABELS: Record<ResumeVariantId, string> = {
  master: 'Мастер',
  germany: 'Германия',
};

const REVIEW_FLAG_LABELS: Record<ResumeReviewFlag, string> = {
  'quantitative-claim-needs-substantiation':
    'Требует подтверждения: сильная количественная заявка',
};

const STALE_REASON_LABELS: Record<StaleEvidenceReason, string> = {
  missing: 'факт отозван из досье',
  'duplicate-current-evidence': 'в досье появился дубликат',
  'no-longer-confirmed': 'больше не подтверждён',
  'became-sensitive': 'помечен как чувствительный',
  'became-non-factual': 'перестал быть фактом',
  'statement-changed': 'формулировка изменилась',
  'provenance-changed': 'источник изменился',
};

export function reviewFlagLabel(flag: ResumeReviewFlag): string {
  return REVIEW_FLAG_LABELS[flag];
}

export function staleReasonLabel(reason: StaleEvidenceReason): string {
  return STALE_REASON_LABELS[reason];
}

/**
 * The engine reports conventions as data; the interface must say them in words,
 * because a candidate cannot check a rule they were never shown.
 */
export function conventionLines(
  conventions: import('./resumeTypes').ResumeConventions,
): readonly string[] {
  const lines = [
    conventions.reverseChronological
      ? 'Обратная хронология: свежая роль первой'
      : 'Порядок ролей — как в черновике',
    conventions.maxPages
      ? `Объём — до ${conventions.maxPages} страниц`
      : 'Объём не ограничен',
    'Без фото, даты рождения, семейного положения и религии',
  ];
  if (conventions.recommendedBulletsPerRole) {
    lines.push(
      `Рекомендация: ${conventions.recommendedBulletsPerRole.min}–${conventions.recommendedBulletsPerRole.max} пункта на роль`,
    );
  }
  return lines;
}
