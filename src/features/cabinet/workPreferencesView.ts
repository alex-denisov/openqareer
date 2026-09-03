import type {
  WorkFamilyCount,
  WorkPreferenceResult,
} from '../../../shared/workPreferences';

/**
 * Как читается результат заданий «Какие роли мне подходят» (B180, срез 3).
 *
 * Правила, которые здесь и проверяются: у каждого числа есть знаменатель,
 * сводного балла не существует, а отказ различить — законный исход, который
 * надо назвать словами, а не спрятать под выдуманным порядком.
 */
export interface WorkPreferencesView {
  /** Из чего собран результат: выборы, виды работы, дата. */
  readonly basisLine: string;
  /** Верхние виды работы — только когда ответы их различили. */
  readonly top: readonly WorkFamilyCount[];
  /** Что кандидат назвал «точно нет». */
  readonly excludedLine: string | null;
  /** Отказ ранжировать, названный словами. */
  readonly undecidedLine: string | null;
  /** Прогон посчитан по прежним формулировкам заданий. */
  readonly staleLine: string | null;
}

export const WORK_PREFERENCES_CAPTION =
  'Уточним порядок ролей, а не оценим вас. Правильных ответов здесь нет.';

export function describeWorkPreferences(input: {
  readonly result: WorkPreferenceResult;
  readonly completedAt: string;
  /** Версия ключа, по которой заданиями спрашивают сейчас. */
  readonly currentKeyVersion: string;
}): WorkPreferencesView {
  const { result } = input;
  return {
    basisLine: `${result.answered} выборов · ${result.counts.length} видов работы · ${formatDay(
      input.completedAt,
    )}`,
    top: result.ranked,
    excludedLine: result.excluded.length
      ? `Вы назвали «точно нет»: ${result.excluded
          .map((code) => result.counts.find((count) => count.family === code)?.name ?? code)
          .join(', ')} — эти виды работы в порядок ролей не входят.`
      : null,
    // Отказ различить — не поломка: так и надо сказать.
    undecidedLine: result.discriminates
      ? null
      : 'Ваши ответы не разделили направления — это нормально и означает, что выбирать надо по фактам опыта и по рынку, а не по предпочтениям.',
    staleLine:
      result.keyVersion === input.currentKeyVersion
        ? null
        : 'Задания с тех пор изменились — этот результат посчитан по прежним формулировкам.',
  };
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(
    new Date(value),
  );
}
