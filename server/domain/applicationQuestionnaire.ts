import { createHash } from 'node:crypto';
import type { HhFormQuestion } from '../../shared/hhCandidateSession';
import {
  QUESTIONNAIRE_ANSWER_MAX_LENGTH,
  QUESTIONNAIRE_MAX_QUESTIONS,
  type AtsFormInput,
  type ApplicationQuestionnaire,
  type QuestionnaireAnswer,
  type QuestionnaireQuestion,
  type QuestionnaireSuggestion,
} from '../../shared/applicationQuestionnaire';
import { profileAnswers, type QuestionnaireProfileFacts } from './questionnaireProfileAnswers';
import { clip, isRecord, OPTION_MAX_LENGTH, QUESTION_TEXT_MAX_LENGTH } from './questionText';

/** Защита от чужого ответа, а не страница списка: настоящие списки (страны) — около 250. */
const MAX_OPTIONS = 2000;
/** Поля, которые Greenhouse добавляет сам: это не вопросы работодателя. */
const STANDARD_FIELD = /^(first_name|last_name|preferred_name|email|phone|resume|resume_text|cover_letter|cover_letter_text|location|linkedin|website)$/u;
const TEXT_TYPES = new Set(['input_text', 'textarea']);
const CHOICE_TYPES = new Set(['multi_value_single_select', 'multi_value_multi_select']);

/** Идентификатор вопроса идёт в ключи и адреса на клиенте: только простые символы. */
const QUESTION_ID = /^[A-Za-z0-9_\-[\]]{1,100}$/u;

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
  if (options.length === 0) return null;
  const choice = { ...base, kind: 'choice' as const, options };
  return field.type === 'multi_value_multi_select' ? { ...choice, multiple: true } : choice;
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

/**
 * Вопросы hh.ru из окна кандидата — чужой текст. Идентификатор считается из самого вопроса: если
 * работодатель поменяет вопрос, прежний ответ не окажется под новым.
 */
export function hhQuestions(raw: readonly HhFormQuestion[]): readonly QuestionnaireQuestion[] {
  const byId = new Map<string, QuestionnaireQuestion>();
  for (const item of raw) {
    const text = clip(item.text, QUESTION_TEXT_MAX_LENGTH);
    const options = (item.options ?? []).map((option) => clip(option, OPTION_MAX_LENGTH)).filter(Boolean);
    if (!text || (item.kind === 'choice' && options.length === 0)) continue;
    const id = `hh-${createHash('sha256')
      .update(JSON.stringify([text, item.kind, options]))
      .digest('hex')
      .slice(0, 24)}`;
    const base = { id, text, required: item.required };
    byId.set(
      id,
      item.kind === 'text'
        ? { ...base, kind: 'text' }
        : { ...base, kind: 'choice', options, ...(item.multiple ? { multiple: true } : {}) },
    );
  }
  return [...byId.values()];
}

/** Вопросы формы работодателя из окна приложения — тоже чужой текст. */
export function atsQuestions(raw: AtsFormInput['questions']): readonly QuestionnaireQuestion[] {
  const byId = new Map<string, QuestionnaireQuestion>();
  for (const item of raw) {
    const text = clip(item.text, QUESTION_TEXT_MAX_LENGTH);
    const options = (item.options ?? []).map((option) => clip(option, OPTION_MAX_LENGTH)).filter(Boolean);
    if (!text || (item.kind === 'choice' && options.length === 0)) continue;
    const base = { id: item.id, text, required: item.required };
    byId.set(
      item.id,
      item.kind === 'text'
        ? { ...base, kind: 'text', ...(item.singleLine ? { singleLine: true } : {}) }
        : { ...base, kind: 'choice', options, ...(item.multiple ? { multiple: true } : {}) },
    );
  }
  return [...byId.values()];
}

/** Ответы после чтения формы: данные профиля встают только туда, где ответа ещё не было. */
export function withKnownAnswers(
  saved: readonly QuestionnaireAnswer[],
  raw: AtsFormInput['questions'],
): readonly QuestionnaireAnswer[] {
  const answered = new Set(saved.map((answer) => answer.questionId));
  const known = raw.flatMap(({ id, known: text }) =>
    text && !answered.has(id) ? [{ questionId: id, text }] : [],
  );
  return [...saved, ...known];
}

const sameText = (text: string): string =>
  text.replace(/\s*[*✱]\s*$/u, '').toLowerCase();

/** Ответы на вопросы с тем же текстом под новым номером; при повторе текста не переносятся. */
export function carryAnswers(
  from: readonly QuestionnaireQuestion[],
  to: readonly QuestionnaireQuestion[],
  saved: readonly QuestionnaireAnswer[],
): readonly QuestionnaireAnswer[] {
  const answered = new Set(saved.map((answer) => answer.questionId));
  const only = (list: readonly QuestionnaireQuestion[], text: string) => {
    const found = list.filter((item) => sameText(item.text) === text);
    return found.length === 1 ? found[0] : null;
  };
  const carried = to.flatMap((question) => {
    const text = sameText(question.text);
    const before = only(from, text);
    if (!before || answered.has(question.id) || !only(to, text)) return [];
    const answer = saved.find((item) => item.questionId === before.id);
    return answer ? [{ questionId: question.id, text: answer.text }] : [];
  });
  return [...saved, ...carried];
}

export interface SalaryProfile {
  readonly salaryFloor?: number;
  readonly salaryCurrency?: string;
}

const SALARY_QUESTION = /доход|зарплат|оклад|вознагражд|компенсац|salary|compensation|pay expectation/iu;
const CURRENCY_SIGNS: Readonly<Record<string, string>> = { RUB: '₽', USD: '$', EUR: '€' };

/** Ответ на вопрос о деньгах: только если ожидания уже записаны в профиле. */
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
  /** Контакты и гражданство из профиля: из них подставляются ответы. */
  readonly facts?: QuestionnaireProfileFacts | null;
  readonly vacancyTitle?: string;
  readonly vacancyCompany?: string;
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

/**
 * Ответы для хранения: как `cleanAnswers`, но пустой ответ на существующий вопрос остаётся —
 * так запоминается, что кандидат стёр подставленное из профиля.
 */
export function answersToStore(
  questions: readonly QuestionnaireQuestion[],
  answers: readonly QuestionnaireAnswer[],
): readonly QuestionnaireAnswer[] {
  const byQuestion = new Map<string, string>();
  for (const answer of answers) {
    byQuestion.set(answer.questionId, answer.text.trim().slice(0, QUESTIONNAIRE_ANSWER_MAX_LENGTH));
  }
  return questions.flatMap((question) => {
    const text = byQuestion.get(question.id);
    return text === undefined ? [] : [{ questionId: question.id, text }];
  });
}

/** Сохранённые ответы и, где ответа ещё нет, подставленные из профиля — в порядке вопросов. */
function withProfileAnswers(
  questions: readonly QuestionnaireQuestion[],
  saved: readonly QuestionnaireAnswer[],
  fromProfile: readonly QuestionnaireSuggestion[],
): readonly QuestionnaireAnswer[] {
  const savedById = new Map(saved.map((answer) => [answer.questionId, answer.text]));
  const profileById = new Map(fromProfile.map((item) => [item.questionId, item.text]));
  return questions.flatMap((question) => {
    const text = savedById.get(question.id) ?? profileById.get(question.id);
    return text ? [{ questionId: question.id, text }] : [];
  });
}

/** Анкета для экрана: вопросы, ответы, подсказки и счётчики готовности. */
export function buildQuestionnaire(input: QuestionnaireInput): ApplicationQuestionnaire {
  const saved = cleanAnswers(input.questions, input.answers);
  const contacts = profileAnswers(input.questions, input.facts ?? null);
  const taken = new Set(contacts.map((item) => item.questionId));
  // Стёртый кандидатом ответ хранится пустым: из профиля он больше не подставляется.
  const cleared = new Set(
    input.answers.filter((answer) => !answer.text.trim()).map((answer) => answer.questionId),
  );
  const fromProfile = [
    ...contacts,
    ...salarySuggestions(input.questions, input.profile).filter((item) => !taken.has(item.questionId)),
  ].filter((item) => !cleared.has(item.questionId));
  const answers = withProfileAnswers(input.questions, saved, fromProfile);
  const answered = new Set(answers.map((answer) => answer.questionId));
  const texts = new Map(answers.map((answer) => [answer.questionId, answer.text]));
  const state = input.state === 'ready' && input.questions.length === 0 ? 'none' : input.state;
  return {
    vacancyId: input.vacancyId,
    ...(input.vacancyTitle ? { vacancyTitle: input.vacancyTitle } : {}),
    ...(input.vacancyCompany ? { vacancyCompany: input.vacancyCompany } : {}),
    state,
    formUrl: input.formUrl,
    questions: input.questions,
    answers,
    // Источник у подставленного ответа виден, пока кандидат не написал своё.
    suggestions: fromProfile.filter((item) => texts.get(item.questionId) === item.text),
    answered: answers.length,
    total: input.questions.length,
    missingRequired: input.questions.filter(
      (question) => question.required && !answered.has(question.id),
    ).length,
    readAt: input.readAt,
    submittedAt: input.submittedAt,
  };
}
