import type { CandidateMemory } from '../coach/coachApi';
import type {
  ResumeReviewFlag,
  ResumeUnknownCode,
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

const UNKNOWN_GROUP_LABELS: Record<ResumeUnknownCode, string> = {
  'missing-full-name': 'Имя',
  'missing-contact': 'Контакты',
  'missing-target-role': 'Целевая роль',
  'missing-role-chronology': 'Даты работы',
  'missing-role-title': 'Должность',
  'missing-employer': 'Работодатель',
  'missing-role-start-date': 'Дата начала',
  'missing-role-end-date': 'Дата окончания',
  'missing-role-claims': 'Что сделано в роли',
  'missing-education': 'Образование',
  'missing-education-details': 'Детали образования',
  'missing-language-name': 'Язык',
  'missing-language-level': 'Уровень языка',
  'chronology-conflict': 'Пересечение периодов',
  'invalid-chronology-date': 'Формат даты',
  'ineligible-evidence': 'Неподтверждённый факт',
  'germany-bullet-count': 'Количество пунктов',
  'germany-length-exceeds-two-pages': 'Объём документа',
};

export function reviewFlagLabel(flag: ResumeReviewFlag): string {
  return REVIEW_FLAG_LABELS[flag];
}

export function staleReasonLabel(reason: StaleEvidenceReason): string {
  return STALE_REASON_LABELS[reason];
}

export function unknownGroupLabel(code: ResumeUnknownCode): string {
  return UNKNOWN_GROUP_LABELS[code];
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

export function evidenceStatementLabel(
  memory: readonly Pick<CandidateMemory, 'id' | 'statement'>[],
  memoryId: string,
  kind: 'stale' | 'excluded',
): string {
  const item = memory.find((m) => m.id === memoryId);
  const statement = item?.statement?.trim();
  if (!statement) {
    return kind === 'stale' ? 'Факт удалён из досье' : 'Запись без текста';
  }
  if (statement.length > 80) {
    return `${statement.slice(0, 80)}…`;
  }
  return statement;
}
