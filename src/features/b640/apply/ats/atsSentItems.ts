import type { AnswerDraft } from '../model/formModel';
import { isCoverLetter, planForm } from './atsFieldPlan';
import type { AtsField } from './atsFormTypes';
import { fieldAnswers } from './atsQuestions';

export interface AtsSentItem {
  readonly key: string;
  readonly question: string;
  readonly answer: string;
}

function answerText(field: AtsField, value: string): string {
  if (field.kind === 'checkbox') return value === 'true' ? 'Да' : 'Нет';
  const picked = field.kind === 'checkbox_group' ? value.split('\n') : [value];
  return picked
    .map((item) => field.options.find((option) => option.value === item)?.label ?? item)
    .join(', ');
}

/** Всё, что уйдёт полями формы: ответы, контакты, согласия и отказы от ответа, как они отметятся. */
export function sentItems(
  fields: readonly AtsField[],
  draft: AnswerDraft,
  host: string,
): readonly AtsSentItem[] {
  const answers = fieldAnswers(fields, draft);
  const { entries } = planForm(
    fields,
    { answers },
    { host, mandateAccepted: true, now: new Date() },
  );
  return entries.flatMap(({ key, value }) => {
    const field = fields.find((item) => item.key === key);
    if (!field || field.kind === 'file' || isCoverLetter(field)) return [];
    return [{ key, question: field.label, answer: answerText(field, value) }];
  });
}
