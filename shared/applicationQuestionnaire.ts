/**
 * B641: анкета работодателя в отклике. Вопросы читаются там, где площадка отдаёт их открыто;
 * ответы пишет кандидат, платформа подсказывает только то, что уже есть в его профиле.
 * Отправляет анкету кандидат сам — на странице работодателя.
 */

export const QUESTIONNAIRE_MAX_QUESTIONS = 40;
export const QUESTIONNAIRE_ANSWER_MAX_LENGTH = 4000;

export type QuestionnaireQuestionKind = 'text' | 'choice';

export interface QuestionnaireQuestion {
  readonly id: string;
  readonly text: string;
  readonly required: boolean;
  readonly kind: QuestionnaireQuestionKind;
  /** Варианты ответа у вопроса с выбором. */
  readonly options?: readonly string[];
  /** B703: у вопроса с выбором можно отметить несколько вариантов; ответ — по варианту на строку. */
  readonly multiple?: boolean;
  /** Поле формы в одну строку: имя, почта, телефон. */
  readonly singleLine?: boolean;
  /** Поле формы принимает только число. */
  readonly numeric?: boolean;
}

export interface QuestionnaireAnswer {
  readonly questionId: string;
  readonly text: string;
}

/** Ответ, подставленный из профиля: в поле стоит то, что в профиле записано. */
export interface QuestionnaireSuggestion {
  readonly questionId: string;
  readonly text: string;
  /** Откуда взято, словами кандидата: «Ожидания из вашего профиля». */
  readonly source: string;
  /** Рыночная цифра: обновляется вместе с данными, пока кандидат не написал своё (B788). */
  readonly live?: true;
}

export interface ApplicationQuestionnaire {
  readonly vacancyId: string;
  /** Название и компания вакансии, как их знает сервер; пусто — не знает. */
  readonly vacancyTitle?: string;
  readonly vacancyCompany?: string;
  /**
   * `ready` — вопросы прочитаны; `none` — у вакансии анкеты нет;
   * `unreadable` — площадка не отдаёт вопросы заранее, анкета открывается на её странице.
   */
  readonly state: 'ready' | 'none' | 'unreadable';
  /** Страница, где кандидат заполняет и отправляет анкету. */
  readonly formUrl: string | null;
  readonly questions: readonly QuestionnaireQuestion[];
  readonly answers: readonly QuestionnaireAnswer[];
  readonly suggestions: readonly QuestionnaireSuggestion[];
  /** Готовых ответов и всего вопросов. */
  readonly answered: number;
  readonly total: number;
  /** Обязательные вопросы без ответа. */
  readonly missingRequired: number;
  readonly readAt: string | null;
  /** Кандидат отметил, что отправил анкету на сайте работодателя. */
  readonly submittedAt: string | null;
}

/** B787: вопросы формы работодателя, прочитанные приложением. */
export interface AtsFormInput {
  readonly url: string;
  readonly questions: readonly (QuestionnaireQuestion & {
    /** Ответ из профиля: ставится, пока кандидат не ответил и не стёр его сам. */
    readonly known?: string;
  })[];
}
