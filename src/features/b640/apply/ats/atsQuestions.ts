import {
  QUESTIONNAIRE_MAX_QUESTIONS,
  type AtsFormInput,
  type QuestionnaireQuestion,
} from '../../../../../shared/applicationQuestionnaire';
import { answerOf, type AnswerDraft } from '../model/formModel';
import { choiceValues } from '../model/choiceModel';
import { categoryOf, consentOption, declines, isCoverLetter, isResumeFile } from './atsFieldPlan';
import type { AtsField, AtsOption } from './atsFormTypes';
import { identityOf, type IdentityFacts } from './atsIdentity';

/** B787: вопросы формы работодателя для шага «Анкета» и ответы шага — обратно в поля формы. */
const YES = 'Да';
const NO = 'Нет';
const TEXT_MAX = 500;
const OPTION_MAX = 200;
const OPTIONS_MAX = 300;
const OPTIONS_TOTAL_MAX = 1_500;
const ANSWER_MAX = 4_000;

/** Как сервер хранит чужой текст: без управляющих символов и лишних пробелов. */
const tidy = (text: string): string =>
  text
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** 53-битный хеш строки: идентификатору вопроса хватает, в адреса и ключи он безопасен. */
function hash(text: string, seed: number): string {
  let high = 0xdeadbeef ^ seed;
  let low = 0x41c6ce57 ^ seed;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    high = Math.imul(high ^ code, 2654435761);
    low = Math.imul(low ^ code, 1597334677);
  }
  high = Math.imul(high ^ (high >>> 16), 2246822507) ^ Math.imul(low ^ (low >>> 13), 3266489909);
  low = Math.imul(low ^ (low >>> 16), 2246822507) ^ Math.imul(high ^ (high >>> 13), 3266489909);
  return (4294967296 * (2097151 & low) + (high >>> 0)).toString(16);
}

/** Вопрос Greenhouse несёт тот же номер, что в его открытом списке: ответ не спрашивается дважды. */
export function questionIdOf(field: AtsField): string {
  const open = /^(?:id|name):(question_\d{1,20}(?:\[\])?)$/u.exec(field.key)?.[1];
  if (open) return open;
  const text = JSON.stringify([field.key, tidy(field.label)]);
  return `ats-${hash(text, 1)}${hash(text, 2)}`;
}

const isChecks = (field: AtsField): boolean => field.kind === 'checkbox_group';

/** Варианты вопроса: без пустой строки-подсказки списка и повторов. */
function optionsOf(field: AtsField): readonly AtsOption[] {
  const seen = new Set<string>();
  return field.options.filter((option) => {
    const label = tidy(option.label);
    if (!label || seen.has(label) || (field.kind === 'select' && option.value === '')) return false;
    seen.add(label);
    return true;
  });
}

function isAsked(field: AtsField): boolean {
  const category = categoryOf(field);
  if (field.kind === 'file' || field.kind === 'password' || category === 'marketing') return false;
  if (isCoverLetter(field)) return false;
  if (field.kind === 'checkbox') {
    if (category === 'processing') return false;
    return category === 'fact' || category === 'composite' || field.required;
  }
  if (category === 'demographic') return field.required && !declines(field);
  if (category === 'processing') return field.required && !consentOption(field);
  return true;
}

/** Поля, которые на форме — одна строка. */
const SINGLE_LINE: ReadonlySet<AtsField['kind']> = new Set([
  'text',
  'email',
  'tel',
  'url',
  'number',
  'date',
]);

function shapeOf(
  field: AtsField,
): Pick<QuestionnaireQuestion, 'kind' | 'options' | 'multiple' | 'singleLine'> {
  if (field.kind === 'checkbox') {
    return field.required
      ? { kind: 'choice', options: [YES], multiple: true }
      : { kind: 'choice', options: [YES, NO] };
  }
  const options = optionsOf(field).map((option) => tidy(option.label));
  if (options.length === 0) {
    return SINGLE_LINE.has(field.kind) ? { kind: 'text', singleLine: true } : { kind: 'text' };
  }
  return { kind: 'choice', options, ...(isChecks(field) ? { multiple: true } : {}) };
}

/** Поля, о которых спрашивает «Анкета». */
export const askedFields = (fields: readonly AtsField[]): readonly AtsField[] =>
  fields.filter(isAsked);

/** Вопросы для «Анкеты»; известное из профиля уже стоит ответом. */
export function atsFormInput(
  url: string,
  fields: readonly AtsField[],
  facts: IdentityFacts,
): AtsFormInput {
  return {
    url,
    questions: askedFields(fields).map((field) => {
      const value = identityOf(field, fields, facts);
      const known = value ? tidy(value) : '';
      return {
        id: questionIdOf(field),
        text: clip(tidy(field.label), TEXT_MAX),
        required: field.required,
        ...shapeOf(field),
        ...(known ? { known } : {}),
      };
    }),
  };
}

/** Форма, которую из приложения не отправить: нечем ответить или вопросы не помещаются. */
export function isBeyondForm(fields: readonly AtsField[]): boolean {
  const asked = askedFields(fields);
  const ids = new Set(asked.map(questionIdOf));
  const options = asked.flatMap((field) => optionsOf(field));
  const missingOptions = asked.some(
    (field) =>
      ['select', 'radio', 'checkbox_group'].includes(field.kind) && optionsOf(field).length === 0,
  );
  return (
    asked.length === 0 ||
    asked.length > QUESTIONNAIRE_MAX_QUESTIONS ||
    ids.size !== asked.length ||
    missingOptions ||
    options.length > OPTIONS_TOTAL_MAX ||
    options.some((option) => tidy(option.label).length > OPTION_MAX) ||
    asked.some((field) => !tidy(field.label) || optionsOf(field).length > OPTIONS_MAX) ||
    fields.some(
      (field) =>
        field.required &&
        (categoryOf(field) === 'marketing' ||
          field.kind === 'password' ||
          (field.kind === 'file' && !isResumeFile(field))),
    )
  );
}

function fieldValue(field: AtsField, text: string): string {
  if (field.kind === 'checkbox') return choiceValues(text).includes(YES) ? 'true' : 'false';
  const options = optionsOf(field);
  const valueOf = (answer: string) =>
    options.find((option) => tidy(option.label) === answer)?.value ?? answer;
  if (isChecks(field)) return choiceValues(text).map(valueOf).join('\n');
  if (options.length > 0) return valueOf(text);
  const day = field.kind === 'date' ? /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(text) : null;
  return day ? `${day[3]}-${day[2]}-${day[1]}` : text.slice(0, ANSWER_MAX);
}

/** Ответы кандидата по ключам полей формы; пустых нет. */
export function fieldAnswers(
  fields: readonly AtsField[],
  draft: AnswerDraft,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    askedFields(fields).flatMap((field) => {
      const text = answerOf(draft, questionIdOf(field)).trim();
      return text ? [[field.key, fieldValue(field, text)]] : [];
    }),
  );
}

/** Ответ, которого среди вариантов списка нет: его нужно выбрать заново. */
export function isOffList(field: AtsField, text: string): boolean {
  const labels = optionsOf(field).map((option) => tidy(option.label));
  if (labels.length === 0 || field.kind === 'checkbox') return false;
  const picked = isChecks(field) ? choiceValues(text) : [text.trim()];
  return picked.some((item) => Boolean(item) && !labels.includes(item));
}

/** Сколько вопросов ещё ждут кандидата. */
export function missingAnswers(fields: readonly AtsField[], draft: AnswerDraft): number {
  return askedFields(fields).filter((field) => {
    const text = answerOf(draft, questionIdOf(field)).trim();
    return (field.required && !text) || isOffList(field, text);
  }).length;
}
