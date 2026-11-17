import {
  QUESTIONNAIRE_ANSWER_MAX_LENGTH,
  QUESTIONNAIRE_MAX_QUESTIONS,
  type ApplicationQuestionnaire,
  type QuestionnaireAnswer,
  type QuestionnaireQuestion,
  type QuestionnaireSuggestion,
} from '../../shared/applicationQuestionnaire';

const QUESTION_TEXT_MAX_LENGTH = 500;
const OPTION_MAX_LENGTH = 200;
const MAX_OPTIONS = 30;
/** Поля, которые Greenhouse добавляет сам: это не вопросы работодателя. */
const STANDARD_FIELD = /^(first_name|last_name|preferred_name|email|phone|resume|resume_text|cover_letter|cover_letter_text|location|linkedin|website)$/u;
const TEXT_TYPES = new Set(['input_text', 'textarea']);
const CHOICE_TYPES = new Set(['multi_value_single_select', 'multi_value_multi_select']);

/** Идентификатор вопроса идёт в ключи и адреса на клиенте: только простые символы. */
const QUESTION_ID = /^[A-Za-z0-9_\-[\]]{1,100}$/u;

function clip(value: string, max: number): string {
  // Управляющие символы и символы смены направления текста в чужом тексте не нужны.
  const flat = value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionLabels(values: unknown): readonly string[] {
  if (!Array.isArray(values)) return [];
  return values
    .flatMap((item) => (isRecord(item) && typeof item.label === 'string' ? [clip(item.label, OPTION_MAX_LENGTH)] : []))
    .filter(Boolean)
    .slice(0, MAX_OPTIONS);
}

function toQuestion(raw: unknown): QuestionnaireQuestion | null {
  if (!isRecord(raw) || typeof raw.label !== 'string' || !Array.isArray(raw.fields)) return null;
  const field: unknown = raw.fields[0];
  if (!isRecord(field) || typeof field.name !== 'string' || typeof field.type !== 'string') return null;
  const text = clip(raw.label, QUESTION_TEXT_MAX_LENGTH);
  if (!text || STANDARD_FIELD.test(field.name) || !QUESTION_ID.test(field.name)) return null;
  const base = { id: field.name, text, required: raw.required === true };
  if (TEXT_TYPES.has(field.type)) return { ...base, kind: 'text' };
  if (!CHOICE_TYPES.has(field.type)) return null;
  const options = optionLabels(field.values);
  return options.length > 0 ? { ...base, kind: 'choice', options } : null;
}

/**
 * Вопросы работодателя из открытого ответа Greenhouse (`?questions=true`). Ответ — чужие
 * данные: всё, что не похоже на вопрос с текстом или выбором, отбрасывается.
 */
export function parseGreenhouseQuestions(payload: unknown): readonly QuestionnaireQuestion[] {
  if (!isRecord(payload) || !Array.isArray(payload.questions)) return [];
  const seen = new Set<string>();
  return payload.questions
    .flatMap((raw) => {
      const question = toQuestion(raw);
      if (!question || seen.has(question.id)) return [];
      seen.add(question.id);
      return [question];
    })
    .slice(0, QUESTIONNAIRE_MAX_QUESTIONS);
}

export interface SalaryProfile {
  readonly salaryFloor?: number;
  readonly salaryCurrency?: string;
}

const SALARY_QUESTION = /доход|зарплат|оклад|вознагражд|компенсац|salary|compensation|pay expectation/iu;
const CURRENCY_SIGNS: Readonly<Record<string, string>> = { RUB: '₽', USD: '$', EUR: '€' };

/** Подсказка на вопрос о деньгах: только если ожидания уже записаны в профиле. */
export function salarySuggestions(
  questions: readonly QuestionnaireQuestion[],
  profile: SalaryProfile | null,
): readonly QuestionnaireSuggestion[] {
  const floor = profile?.salaryFloor;
  if (!floor || !Number.isFinite(floor) || floor <= 0) return [];
  const currency = profile?.salaryCurrency ?? 'RUB';
  const amount = new Intl.NumberFormat('ru-RU').format(floor).replace(/\p{Zs}/gu, ' ');
  const sign = Object.hasOwn(CURRENCY_SIGNS, currency) ? CURRENCY_SIGNS[currency] : currency;
  const text = `от ${amount} ${sign}`;
  return questions
    .filter((question) => question.kind === 'text' && SALARY_QUESTION.test(question.text))
    .map((question) => ({ questionId: question.id, text, source: 'Ожидания из вашего профиля' }));
}

export interface QuestionnaireInput {
  readonly vacancyId: string;
  readonly state: ApplicationQuestionnaire['state'];
  readonly formUrl: string | null;
  readonly questions: readonly QuestionnaireQuestion[];
  readonly answers: readonly QuestionnaireAnswer[];
  readonly profile: SalaryProfile | null;
  readonly readAt: string | null;
  readonly submittedAt: string | null;
}

/** Ответы только на существующие вопросы, без пустых и длиннее предела. */
export function cleanAnswers(
  questions: readonly QuestionnaireQuestion[],
  answers: readonly QuestionnaireAnswer[],
): readonly QuestionnaireAnswer[] {
  const known = new Set(questions.map((question) => question.id));
  const byQuestion = new Map<string, string>();
  for (const answer of answers) {
    const text = answer.text.trim().slice(0, QUESTIONNAIRE_ANSWER_MAX_LENGTH);
    if (known.has(answer.questionId) && text) byQuestion.set(answer.questionId, text);
  }
  return questions.flatMap((question) => {
    const text = byQuestion.get(question.id);
    return text ? [{ questionId: question.id, text }] : [];
  });
}

/** Анкета для экрана: вопросы, ответы, подсказки и счётчики готовности. */
export function buildQuestionnaire(input: QuestionnaireInput): ApplicationQuestionnaire {
  const answers = cleanAnswers(input.questions, input.answers);
  const answered = new Set(answers.map((answer) => answer.questionId));
  const state = input.state === 'ready' && input.questions.length === 0 ? 'none' : input.state;
  return {
    vacancyId: input.vacancyId,
    state,
    formUrl: input.formUrl,
    questions: input.questions,
    answers,
    suggestions: salarySuggestions(input.questions, input.profile).filter(
      (suggestion) => !answered.has(suggestion.questionId),
    ),
    answered: answers.length,
    total: input.questions.length,
    missingRequired: input.questions.filter(
      (question) => question.required && !answered.has(question.id),
    ).length,
    readAt: input.readAt,
    submittedAt: input.submittedAt,
  };
}
