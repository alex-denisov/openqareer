import type { ManualApplyReason } from '../../../../../shared/manualApply';
import type { AnswerDraft } from '../model/formModel';
import type { AtsConsentJournal } from './atsConsentJournal';
import type * as desktop from './atsDesktop';
import { planForm, type AtsConsentRecord, type CandidateFacts } from './atsFieldPlan';
import type { AtsEntry, AtsField, AtsFile, AtsFormReport, AtsReceipt } from './atsFormTypes';
import type { IdentityFacts } from './atsIdentity';
import { fieldAnswers, isBeyondForm, missingAnswers } from './atsQuestions';
import { sendAtsForm } from './atsSend';

/** B787: форма работодателя целиком — от чтения до одного нажатия. Экрана здесь нет. */
export type AtsDesktop = typeof desktop;

/** Открытая форма: поля всех её страниц и то, что стоит на текущей. */
export interface AtsForm {
  readonly host: string;
  /** Поля текущей страницы. */
  readonly page: readonly AtsField[];
  /** Поля уже пройденных страниц: их ответы остаются в «Анкете». */
  readonly passed: readonly AtsField[];
  readonly step: 'next' | 'submit';
  /** Согласия, поставленные на пройденных страницах. */
  readonly consents: readonly AtsConsentRecord[];
}

export const allFields = (form: AtsForm): readonly AtsField[] => [...form.passed, ...form.page];

export interface AtsManual {
  readonly kind: 'manual';
  readonly reason: ManualApplyReason;
  readonly host: string;
}

export type AtsRunResult =
  | { readonly kind: 'sent'; readonly receipt: AtsReceipt }
  /** Нажатие было, подтверждения нет: второго нажатия не будет. */
  | { readonly kind: 'unconfirmed'; readonly host: string }
  /** Появились вопросы, на которые отвечает кандидат. */
  | { readonly kind: 'ask'; readonly form: AtsForm }
  /** Форма отказала своим полям: ничего не ушло. */
  | { readonly kind: 'refused'; readonly host: string }
  /** До нажатия не дошло: можно повторить. */
  | { readonly kind: 'failed' }
  | AtsManual;

const READ_REASONS: Readonly<Record<Exclude<AtsFormReport['state'], 'ready'>, ManualApplyReason>> =
  {
    account_required: 'account_required',
    captcha: 'captcha',
    form_missing: 'other',
    off_target: 'other',
    unreadable: 'other',
  };

const manual = (reason: ManualApplyReason, host: string): AtsManual => ({
  kind: 'manual',
  reason,
  host,
});

/** Прочитанная страница: форма — или почему её отправляет кандидат сам. */
export function formOf(
  report: AtsFormReport,
  fallbackHost: string,
  before?: AtsForm,
): AtsForm | AtsManual {
  const host = report.host || fallbackHost;
  if (report.state !== 'ready') return manual(READ_REASONS[report.state], host);
  const page = report.form.fields ?? [];
  const form: AtsForm = {
    host,
    page,
    passed: before?.passed ?? [],
    step: report.form.step ?? 'submit',
    consents: before?.consents ?? [],
  };
  return isBeyondForm(allFields(form)) ? manual('other', host) : form;
}

const REFUSED_ADDRESS = /^ats_(?:unsupported|address_invalid|board_unknown)/u;

const codeOf = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason ?? '');

/** Адрес приложению не подошёл: форма этой вакансии ему неизвестна. */
export const isUnknownForm = (reason: unknown): boolean => REFUSED_ADDRESS.test(codeOf(reason));

/** Страница ушла с формы этой вакансии. */
export const isOffTarget = (reason: unknown): boolean => codeOf(reason).startsWith('off_target');

export interface AtsRunInput {
  readonly vacancyId: string;
  readonly applicationId: string;
  readonly employer: string;
  readonly letter: string;
  readonly facts: IdentityFacts;
  readonly resume: AtsFile | null;
  readonly draft: AnswerDraft;
  readonly now: () => Date;
}

export interface AtsRunDeps {
  readonly desktop: AtsDesktop;
  readonly journal: AtsConsentJournal;
  readonly newId: () => string;
}

/** Команда кандидата, по которой уходит отклик. */
export const SEND_COMMAND = 'Отправить отклик';
const MAX_PAGES = 8;

function candidateFacts(input: AtsRunInput, fields: readonly AtsField[]): CandidateFacts {
  return {
    ...input.facts,
    ...(input.resume ? { resume: input.resume } : {}),
    coverLetter: input.letter,
    answers: fieldAnswers(fields, input.draft),
  };
}

/** Значения с экрана: стёртое кандидатом из профиля снова не подставляется. */
function shownFacts(facts: CandidateFacts): CandidateFacts {
  const { resume, coverLetter, answers } = facts;
  return { ...(resume ? { resume } : {}), coverLetter, answers };
}

interface Filled {
  readonly values: Readonly<Record<string, string>>;
  /** Поля, которые форма не взяла. */
  readonly failed: readonly AtsField[];
}

const wrote = (
  entry: AtsEntry,
  results: Readonly<Record<string, string>>,
  values: Readonly<Record<string, string>>,
): boolean =>
  results[entry.key] === 'set' && (!(entry.value || entry.file) || Boolean(values[entry.key]));

/** Галочки, которые страница поставила сама: кандидат их не подтверждал. */
function tickedByPage(
  fields: readonly AtsField[],
  entries: readonly AtsEntry[],
  values: Readonly<Record<string, string>>,
): readonly AtsEntry[] {
  const ours = new Set(entries.map((entry) => entry.key));
  return fields.flatMap(({ key, kind }) => {
    if (ours.has(key) || !values[key]) return [];
    if (kind === 'checkbox' && values[key] === 'true') return [{ key, value: 'false' }];
    return kind === 'checkbox_group' ? [{ key, value: '' }] : [];
  });
}

async function fill(
  input: AtsRunInput,
  deps: AtsRunDeps,
  page: readonly AtsField[],
  entries: readonly AtsEntry[],
): Promise<Filled | 'page_ticked' | null> {
  const first = await deps.desktop.fillAtsForm(input.vacancyId, entries);
  if (!first) return null;
  const failed = entries.filter((entry) => !wrote(entry, first.results, first.values));
  const fields = page.filter((field) => failed.some((entry) => entry.key === field.key));
  const ticked = tickedByPage(page, entries, first.values);
  if (ticked.length === 0) return { values: first.values, failed: fields };
  const second = await deps.desktop.fillAtsForm(input.vacancyId, ticked);
  if (!second) return null;
  const left = tickedByPage(page, entries, second.values);
  return left.length > 0 ? 'page_ticked' : { values: second.values, failed: fields };
}

/** Список не взял значение: его варианты читаются и выбираются кандидатом. */
async function withOptions(
  input: AtsRunInput,
  deps: AtsRunDeps,
  form: AtsForm,
  failed: readonly AtsField[],
): Promise<AtsForm | AtsManual> {
  const { answers } = candidateFacts(input, form.page);
  const read = new Map<string, AtsField>();
  for (const field of failed) {
    const query = (answers[field.key] ?? '').split(',')[0]!;
    const options =
      field.kind === 'combobox' && field.options.length === 0
        ? await deps.desktop.readAtsOptions(input.vacancyId, field.key, query)
        : null;
    if (options && options.length > 0) read.set(field.key, { ...field, options });
  }
  if (failed.some((field) => field.required && !read.has(field.key))) {
    return manual('other', form.host);
  }
  if (read.size === 0) return form;
  const page = form.page.map((field) => read.get(field.key) ?? field);
  return isBeyondForm(page) ? manual('other', form.host) : { ...form, page };
}

/** Ответ открыл на странице новые вопросы: страница читается заново. */
async function reread(
  input: AtsRunInput,
  deps: AtsRunDeps,
  form: AtsForm,
  values: Readonly<Record<string, string>>,
): Promise<AtsForm | AtsManual> {
  const known = new Set(form.page.map((field) => field.key));
  if (Object.keys(values).every((key) => known.has(key))) return form;
  const report = await deps.desktop.readAtsForm(input.vacancyId);
  if (!report) return manual('other', form.host);
  return formOf(report, form.host, form);
}

type Page =
  | { readonly kind: 'filled'; readonly form: AtsForm; readonly values: Filled['values'] }
  | AtsRunResult;

async function fillPage(input: AtsRunInput, deps: AtsRunDeps, form: AtsForm): Promise<Page> {
  if (missingAnswers(form.page, input.draft) > 0) return { kind: 'ask', form };
  const context = { host: form.host, mandateAccepted: true, now: input.now() };
  const facts = shownFacts(candidateFacts(input, form.page));
  const plan = planForm(form.page, facts, context);
  if (plan.questions.some((question) => question.required)) return manual('other', form.host);
  if (plan.entries.length === 0) return manual('other', form.host);
  const filled = await fill(input, deps, form.page, plan.entries);
  if (!filled) return { kind: 'failed' };
  if (filled === 'page_ticked') return manual('other', form.host);
  if (filled.failed.length > 0) {
    const next = await withOptions(input, deps, form, filled.failed);
    if ('kind' in next) return next;
    if (next !== form) return { kind: 'ask', form: next };
  }
  const shown = await reread(input, deps, form, filled.values);
  if ('kind' in shown) return shown;
  if (shown !== form) return { kind: 'ask', form: shown };
  const consents = [...form.consents, ...plan.consents];
  return { kind: 'filled', form: { ...form, consents }, values: filled.values };
}

async function turnPage(
  input: AtsRunInput,
  deps: AtsRunDeps,
  form: AtsForm,
  values: Filled['values'],
): Promise<AtsForm | AtsRunResult> {
  const step = await deps.desktop.nextAtsStep(input.vacancyId, values);
  if (!step) return { kind: 'failed' };
  if (step.state === 'captcha') return manual('captcha', form.host);
  if (step.state === 'invalid') return { kind: 'refused', host: form.host };
  if (step.state !== 'moved' || !step.form) return manual('other', form.host);
  return formOf(step.form, form.host, { ...form, passed: allFields(form) });
}

/** Причины, по которым приложение не нажало кнопку, хотя могло бы: повтор уместен. */
const RETRY = new Set(['not_confirmed', 'attempt_unrecorded', 'form_not_filled']);

function resultOfReceipt(receipt: AtsReceipt, fallbackHost: string): AtsRunResult {
  const host = receipt.host || fallbackHost;
  if (receipt.outcome === 'confirmed') return { kind: 'sent', receipt: { ...receipt, host } };
  if (receipt.reason === 'already_submitted') return { kind: 'unconfirmed', host };
  if (receipt.outcome === 'rejected') return { kind: 'refused', host };
  if (receipt.outcome === 'captcha' && receipt.pressedAtMs === null) return manual('captcha', host);
  if (receipt.outcome !== 'not_submitted') return { kind: 'unconfirmed', host };
  return receipt.reason && RETRY.has(receipt.reason) ? { kind: 'failed' } : manual('other', host);
}

async function press(
  input: AtsRunInput,
  deps: AtsRunDeps,
  form: AtsForm,
  values: Filled['values'],
): Promise<AtsRunResult> {
  const { vacancyId, applicationId, employer } = input;
  const result = await sendAtsForm(
    {
      vacancyId,
      applicationId,
      employer,
      command: SEND_COMMAND,
      values,
      consents: form.consents,
    },
    { journal: deps.journal, submit: deps.desktop.submitAtsForm, newId: deps.newId },
  );
  if (result.kind === 'unknown') return { kind: 'unconfirmed', host: form.host };
  if (result.kind === 'consent_unrecorded') return { kind: 'failed' };
  return resultOfReceipt(result.receipt, form.host);
}

/**
 * Заполнить форму и отправить её одним нажатием. Вызывать только по команде кандидата и при
 * принятом поручении; всё, чего приложение не знает, возвращается вопросом.
 */
export async function runAtsForm(
  start: AtsForm,
  input: AtsRunInput,
  deps: AtsRunDeps,
): Promise<AtsRunResult> {
  let form = start;
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await fillPage(input, deps, form);
    if (page.kind !== 'filled') return page;
    if (page.form.step === 'submit') return press(input, deps, page.form, page.values);
    const next = await turnPage(input, deps, page.form, page.values);
    if ('kind' in next) return next;
    form = next;
  }
  return manual('other', form.host);
}
