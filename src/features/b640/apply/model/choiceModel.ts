import type { QuestionnaireQuestion } from '../../../../../shared/applicationQuestionnaire';

/** B703: ответ на вопрос с выбором хранится строкой — по варианту на строку. */
export function choiceValues(text: string): readonly string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Ответ после щелчка по варианту. Один ответ — выбор заменяет прежний; несколько — отметка
 * добавляет или снимает вариант, порядок как у вариантов, ответ вне вариантов остаётся в конце.
 */
export function toggleChoice(question: QuestionnaireQuestion, current: string, option: string): string {
  if (!question.multiple) return option;
  const picked = new Set(choiceValues(current));
  if (picked.has(option)) picked.delete(option);
  else picked.add(option);
  const options = question.options ?? [];
  const known = options.filter((value) => picked.has(value));
  const other = [...picked].filter((value) => !options.includes(value));
  return [...known, ...other].join('\n');
}
