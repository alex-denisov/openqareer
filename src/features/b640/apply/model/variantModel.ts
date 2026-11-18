import type { LetterVariantPayload } from '../../../../../shared/textVariants';
import type { VacancyPitchResult } from '../../../vacancies/vacancyPitchApi';

/** Правки кандидата по ключу текста: у первого письма и у каждого варианта своя. */
export type VariantEdits = Readonly<Record<string, string>>;

/** Ключ первого письма; у варианта ключ — его идентификатор. */
export const FIRST_LETTER_KEY = 'first';

export interface VariantSwitch {
  readonly edits: VariantEdits;
  /** Текст, который встаёт в поле письма. */
  readonly text: string;
}

/**
 * Переход к другому тексту: то, что сейчас в поле, остаётся за текстом, с которого уходят;
 * у текста, к которому приходят, возвращается его правка, а без неё — написанное платформой.
 */
export function switchVariant(
  edits: VariantEdits,
  from: { readonly key: string; readonly text: string },
  to: { readonly key: string; readonly generated: string },
): VariantSwitch {
  const next = { ...edits, [from.key]: from.text };
  return { edits: next, text: Object.hasOwn(next, to.key) ? next[to.key]! : to.generated };
}

/**
 * Письмо, которое уходит в одобрение: у выбранного варианта — его тема и его факты профиля.
 * Вариант, сохранённый до появления фактов в данных, одобряется с фактами первого письма.
 */
export function approvalPitch(
  pitch: VacancyPitchResult | null,
  variant: LetterVariantPayload | null,
): VacancyPitchResult | null {
  if (!pitch || !variant) return pitch;
  return {
    ...pitch,
    emailPitch: variant.emailPitch,
    usedEvidenceIds: variant.usedEvidenceIds ?? pitch.usedEvidenceIds,
  };
}
