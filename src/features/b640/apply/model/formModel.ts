import type {
  ApplicationQuestionnaire,
  QuestionnaireAnswer,
  QuestionnaireQuestion,
} from '../../../../../shared/applicationQuestionnaire';
import type { HhFormAnswer } from '../../../../../shared/hhCandidateSession';
import { isBadNumber } from '../../../../../shared/questionnaireNumber';
import { choiceValues } from './choiceModel';
import { pluralRu } from '../../responses/model/responseRow';

export type AnswerDraft = Readonly<Record<string, string>>;

/** Ответ из черновика. Идентификатор вопроса — чужой текст: читаем только свои ключи. */
export function answerOf(draft: AnswerDraft, questionId: string): string {
  return Object.hasOwn(draft, questionId) ? draft[questionId]! : '';
}

export function draftOf(form: ApplicationQuestionnaire): AnswerDraft {
  return Object.fromEntries(form.answers.map((answer) => [answer.questionId, answer.text]));
}

/** Пустой ответ тоже уходит на сервер: так стёртое из профиля не подставится снова. */
export function answersOf(draft: AnswerDraft): readonly QuestionnaireAnswer[] {
  return Object.entries(draft).map(([questionId, text]) => ({ questionId, text: text.trim() }));
}

export interface FormReadiness {
  readonly answered: number;
  readonly total: number;
  /** Первый обязательный вопрос без ответа: к нему ведёт главная кнопка. */
  readonly nextRequired: QuestionnaireQuestion | null;
  readonly missingRequired: number;
}

export function readiness(questions: readonly QuestionnaireQuestion[], draft: AnswerDraft): FormReadiness {
  const filled = (question: QuestionnaireQuestion) => {
    const text = answerOf(draft, question.id);
    return Boolean(text.trim()) && !isBadNumber(question, text);
  };
  const missing = questions.filter(
    (question) =>
      !filled(question) &&
      (question.required || isBadNumber(question, answerOf(draft, question.id))),
  );
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

/** Ответы для анкеты в окне hh.ru: у выбора — по варианту, у текста — целиком; пустых нет. */
export function hhAnswers(questions: readonly QuestionnaireQuestion[], draft: AnswerDraft): readonly HhFormAnswer[] {
  return questions.flatMap((question) => {
    const text = answerOf(draft, question.id).trim();
    if (!text) return [];
    return [{ text: question.text, values: question.kind === 'choice' ? choiceValues(text) : [text] }];
  });
}

/** Вопросы и ответы одним текстом — чтобы вставить на странице работодателя. */
export function copyText(questions: readonly QuestionnaireQuestion[], draft: AnswerDraft): string {
  return questions
    .filter((question) => answerOf(draft, question.id).trim())
    .map((question) => `${question.text}\n${answerOf(draft, question.id).trim()}`)
    .join('\n\n');
}
