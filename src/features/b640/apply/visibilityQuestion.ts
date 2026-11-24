import { useMemo, useState } from 'react';
import type { QuestionnaireQuestion } from '../../../../shared/applicationQuestionnaire';

export const VISIBILITY_YES = 'Да';

/** Вопрос hh.ru о показе резюме: отвечает кандидат, в ответы работодателю он не входит. */
export const VISIBILITY_QUESTION: QuestionnaireQuestion = {
  id: 'hh-visibility',
  text: 'hh.ru покажет ваше резюме работодателям из другой страны. Разрешить?',
  required: true,
  kind: 'choice',
  options: [VISIBILITY_YES, 'Нет'],
};

export interface VisibilityState {
  /** `null` — hh.ru не спрашивал. */
  readonly value: string | null;
  readonly agreed: boolean;
  readonly set: (value: string) => void;
  /** hh.ru спросил: вопрос появляется в анкете, данный ответ не теряется. */
  readonly ask: () => void;
}

export function useVisibilityQuestion(): VisibilityState {
  const [value, set] = useState<string | null>(null);
  return useMemo(
    () => ({
      value,
      agreed: value === VISIBILITY_YES,
      set,
      ask: () => set((current) => current ?? ''),
    }),
    [value],
  );
}
