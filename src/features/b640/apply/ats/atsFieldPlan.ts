import type { AtsEntry, AtsField, AtsFile, AtsOption } from './atsFormTypes';

/**
 * B787: что приложение ставит в поле формы само, а что спрашивает у кандидата.
 * Узнавание — только по фиксированным шаблонам подписи; поле, которое шаблон не узнал,
 * приложение не заполняет догадкой.
 */
export interface CandidateFacts {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly linkedin?: string;
  readonly location?: string;
  readonly country?: string;
  readonly website?: string;
  readonly resume?: AtsFile;
  readonly coverLetter?: string;
  /** Ответы кандидата по ключу поля: то, что он ввёл или подтвердил на экране «Анкета». */
  readonly answers: Readonly<Record<string, string>>;
}

export type AtsQuestionReason =
  /** Обязательное поле без ответа. */
  | 'no_answer'
  /** Право на работу, виза, судимость, достоверность и подобное: только словами кандидата. */
  | 'fact_needed'
  /** Обязательная галочка, которую шаблоны не узнали. */
  | 'unknown_checkbox'
  /** Работодатель требует согласие на рассылку или хранение: приложение его не ставит. */
  | 'optional_consent_required'
  /** Согласие на обработку данных без принятого поручения. */
  | 'consent_needs_mandate'
  | 'demographic';

export interface AtsQuestion {
  readonly key: string;
  readonly label: string;
  readonly kind: AtsField['kind'];
  readonly options: readonly AtsOption[];
  readonly required: boolean;
  readonly reason: AtsQuestionReason;
}

/** Запись журнала о поставленном согласии: какой текст, чья политика, где и когда. */
export interface AtsConsentRecord {
  readonly key: string;
  readonly text: string;
  readonly link: string | null;
  readonly host: string;
  readonly at: string;
}

export interface AtsPlan {
  readonly entries: readonly AtsEntry[];
  readonly questions: readonly AtsQuestion[];
  readonly consents: readonly AtsConsentRecord[];
}

export interface PlanContext {
  readonly host: string;
  readonly mandateAccepted: boolean;
  readonly now: Date;
}

type Category = 'marketing' | 'processing' | 'fact' | 'demographic' | 'other';

const MARKETING =
  /marketing|newsletter|job alerts?|talent (community|pool|network)|future (opportunit|opening|position|role|vacanc)|other (roles|positions|opportunit)|retain|keep (my|your) (data|application|details|information|profile)|рассылк|новост|будущ\S* ваканс|кадров\S* резерв|хран(ить|ение)/i;
const PROCESSING =
  /privacy (policy|notice|statement)|personal (data|information)|data protection|gdpr|processing of (my|your)|персональн\S* данн|политик\S* конфиденциальности/i;
const FACT =
  /authori[sz]ed to work|right to work|work (permit|authori[sz]ation)|sponsor|visa|convict|criminal|felony|relative|related to|non-?compete|non-?disclosure|\bnda\b|certify|true and (accurate|complete|correct)|previously (worked|employed|applied)|право на работу|разрешени\S* на работу|судим|достоверн|родствен/i;
const DEMOGRAPHIC =
  /gender|ethnic|\brace\b|veteran|disabilit|sexual orientation|pronoun|hispanic|latino|\bпол\b|инвалидн|национальност/i;
const DECLINE =
  /prefer not|decline|don'?t wish|do not wish|not to (say|answer|disclose)|не хочу|предпочитаю не/i;

const IDENTITY: readonly (readonly [RegExp, keyof CandidateFacts])[] = [
  [/^(legal )?first name|^given name|^имя$/i, 'firstName'],
  [/^(legal )?last name|^surname|^family name|^фамилия$/i, 'lastName'],
  [/^e-?mail|^электронная почта|^почта$/i, 'email'],
  [/^(mobile |cell )?phone|^телефон/i, 'phone'],
  [/linkedin/i, 'linkedin'],
  [/^country|^страна/i, 'country'],
  [/^(current )?location|^city|^город/i, 'location'],
  [/^(personal )?website|^portfolio|^сайт|^портфолио/i, 'website'],
];

function categoryOf(label: string): Category {
  if (MARKETING.test(label)) return 'marketing';
  if (FACT.test(label)) return 'fact';
  if (DEMOGRAPHIC.test(label)) return 'demographic';
  return PROCESSING.test(label) ? 'processing' : 'other';
}

function identityOf(field: AtsField, facts: CandidateFacts): string | undefined {
  const match = IDENTITY.find(([pattern]) => pattern.test(field.label.trim()));
  const value = match ? facts[match[1]] : undefined;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function question(field: AtsField, reason: AtsQuestionReason): AtsQuestion {
  const { key, label, kind, options, required } = field;
  return { key, label, kind, options, required, reason };
}

type Step =
  | { readonly entry: AtsEntry; readonly consent?: boolean }
  | { readonly ask: AtsQuestionReason }
  | null;

function fileStep(field: AtsField, facts: CandidateFacts): Step {
  if (/resume|\bcv\b|резюме/i.test(field.label) && facts.resume) {
    return { entry: { key: field.key, value: '', file: facts.resume } };
  }
  return field.required ? { ask: 'no_answer' } : null;
}

function checkboxStep(field: AtsField, category: Category, context: PlanContext): Step {
  if (category === 'marketing') return field.required ? { ask: 'optional_consent_required' } : null;
  if (category === 'processing') {
    if (!field.required) return null;
    if (!context.mandateAccepted) return { ask: 'consent_needs_mandate' };
    return { entry: { key: field.key, value: 'true' }, consent: true };
  }
  if (category === 'fact') return { ask: 'fact_needed' };
  return field.required ? { ask: 'unknown_checkbox' } : null;
}

const AFFIRMATIVE =
  /^(true|yes\b|i (agree|accept|consent|acknowledge)|i give (my )?consent|agree|accept|да(?!\S)|(я )?(даю согласие|соглас|принима|подтвержда))/i;

/**
 * Ответ кандидата. Согласие на обработку и по ответу ставится только обязательной галочкой или
 * «да» в списке, только при поручении и всегда с записью в журнал.
 */
function answerStep(field: AtsField, answer: string, context: PlanContext): Step {
  const entry = { key: field.key, value: answer };
  // У вопроса с несколькими галочками ответ — варианты через перевод строки.
  const picked = field.kind === 'checkbox_group' ? answer.split('\n').filter(Boolean) : [answer];
  const chosen = picked.map(
    (value) => field.options.find((option) => option.value === value)?.label ?? value,
  );
  if (![field.label, ...chosen].some((text) => PROCESSING.test(text))) return { entry };
  const agrees = chosen.some((text) => AFFIRMATIVE.test(text.trim()));
  if (field.kind === 'checkbox') {
    if (!field.required) return null;
    if (!agrees) return { ask: 'no_answer' };
  }
  if (!agrees) return { entry };
  return context.mandateAccepted ? { entry, consent: true } : { ask: 'consent_needs_mandate' };
}

function demographicStep(field: AtsField): Step {
  const decline = field.options.find((option) => DECLINE.test(option.label));
  if (decline) return { entry: { key: field.key, value: decline.label } };
  return field.required ? { ask: 'demographic' } : null;
}

function stepFor(field: AtsField, facts: CandidateFacts, context: PlanContext): Step {
  const answer = facts.answers[field.key];
  const category = categoryOf(field.label);
  if (field.kind === 'file') return fileStep(field, facts);
  if (field.kind === 'password') return null;
  // Ответ самого кандидата сильнее любого шаблона, кроме рассылок и хранения.
  if (answer !== undefined && answer !== '' && category !== 'marketing') {
    return answerStep(field, answer, context);
  }
  if (field.kind === 'checkbox') return checkboxStep(field, category, context);
  if (category === 'marketing') return field.required ? { ask: 'optional_consent_required' } : null;
  if (category === 'fact') return { ask: 'fact_needed' };
  if (category === 'demographic') return demographicStep(field);
  if (category === 'processing')
    return { ask: context.mandateAccepted ? 'no_answer' : 'consent_needs_mandate' };
  const known = identityOf(field, facts);
  if (known) return { entry: { key: field.key, value: known } };
  if (/cover letter|сопроводительн/i.test(field.label) && facts.coverLetter) {
    return { entry: { key: field.key, value: facts.coverLetter } };
  }
  return field.required ? { ask: 'no_answer' } : null;
}

/** План заполнения: что ставится само, что спросить и какие согласия записать в журнал. */
export function planForm(
  fields: readonly AtsField[],
  facts: CandidateFacts,
  context: PlanContext,
): AtsPlan {
  const steps = fields.map((field) => ({ field, step: stepFor(field, facts, context) }));
  const entries = steps.flatMap(({ step }) => (step && 'entry' in step ? [step.entry] : []));
  const questions = steps.flatMap(({ field, step }) =>
    step && 'ask' in step ? [question(field, step.ask)] : [],
  );
  const consents = steps.flatMap(({ field, step }) =>
    step && 'entry' in step && step.consent
      ? [
          {
            key: field.key,
            text: field.label,
            link: field.link,
            host: context.host,
            at: context.now.toISOString(),
          },
        ]
      : [],
  );
  return { entries, questions, consents };
}
