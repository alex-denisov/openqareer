import type {
  ApplicationQuestionnaire,
  QuestionnaireAnswer,
  QuestionnaireQuestion,
} from '../../../../../shared/applicationQuestionnaire';
import { pluralRu } from '../../responses/model/responseRow';

export type AnswerDraft = Readonly<Record<string, string>>;

export function draftOf(form: ApplicationQuestionnaire): AnswerDraft {
  return Object.fromEntries(form.answers.map((answer) => [answer.questionId, answer.text]));
}

export function answersOf(draft: AnswerDraft): readonly QuestionnaireAnswer[] {
  return Object.entries(draft)
    .map(([questionId, text]) => ({ questionId, text: text.trim() }))
    .filter((answer) => answer.text);
}

export interface FormReadiness {
  readonly answered: number;
  readonly total: number;
  /** Первый обязательный вопрос без ответа: к нему ведёт главная кнопка. */
  readonly nextRequired: QuestionnaireQuestion | null;
  readonly missingRequired: number;
}

export function readiness(questions: readonly QuestionnaireQuestion[], draft: AnswerDraft): FormReadiness {
  const filled = (question: QuestionnaireQuestion) => Boolean(draft[question.id]?.trim());
  const missing = questions.filter((question) => question.required && !filled(question));
  return {
    answered: questions.filter(filled).length,
    total: questions.length,
    nextRequired: missing[0] ?? null,
    missingRequired: missing.length,
  };
}

/** «3 ответа из 5 готовы». */
export function readinessTitle(state: FormReadiness): string {
  const noun = pluralRu(state.answered, ['ответ', 'ответа', 'ответов']);
  const ready = state.answered === 1 ? 'готов' : 'готовы';
  return `${state.answered} ${noun} из ${state.total} ${ready}`;
}

/** Вопросы и ответы одним текстом — чтобы вставить на странице работодателя. */
export function copyText(questions: readonly QuestionnaireQuestion[], draft: AnswerDraft): string {
  return questions
    .filter((question) => draft[question.id]?.trim())
    .map((question) => `${question.text}\n${draft[question.id]!.trim()}`)
    .join('\n\n');
}
