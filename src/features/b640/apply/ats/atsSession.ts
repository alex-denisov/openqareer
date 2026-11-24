import type { ManualApplyReason } from '../../../../../shared/manualApply';
import { getAccountCapabilityConsents } from '../../../account/accountCapabilityConsentApi';
import { serverConsentJournal } from './atsConsentJournal';
import * as desktop from './atsDesktop';
import { loadAtsFacts, loadAtsResume } from './atsFacts';
import { isResumeFile } from './atsFieldPlan';
import type { AtsConfirmation } from './atsFormTypes';
import type { IdentityFacts } from './atsIdentity';
import { hasApplyMandate } from './atsMandate';
import {
  allFields,
  formOf,
  isUnknownForm,
  runAtsForm,
  type AtsForm,
  type AtsRunResult,
} from './atsRun';
import { settleAtsConsents } from './atsSend';
import type { AtsAddress } from './atsTarget';
import type { AnswerDraft } from '../model/formModel';
import type { ApprovedVacancyLetterResult } from '../../../vacancies/vacancyLetterApi';

/** B787: форма работодателя в окне приложения — открыть, узнать прежний итог, отправить. */
export type AtsApplyState =
  | { readonly kind: 'reading' }
  | { readonly kind: 'read_failed' }
  | { readonly kind: 'ready' }
  /** Поручение ещё не дано: спрашивают один раз, отклик уходит сразу после согласия. */
  | { readonly kind: 'mandate' }
  | { readonly kind: 'sending'; readonly seconds: number }
  | { readonly kind: 'sent'; readonly receipt: AtsConfirmation }
  | { readonly kind: 'unconfirmed'; readonly host: string }
  | { readonly kind: 'refused'; readonly host: string }
  | { readonly kind: 'failed' }
  /** Отклик уходит в очередь кандидата. */
  | { readonly kind: 'manual' };

const DEPS = {
  desktop,
  journal: serverConsentJournal,
  newId: () => crypto.randomUUID(),
};

export interface AtsSession {
  readonly form: AtsForm;
  readonly facts: IdentityFacts;
}

/** Окно формы одно на приложение: новая форма ждёт конца идущей отправки. */
let running: Promise<unknown> = Promise.resolve();

/** Отправка идёт: пока она не закончилась, новая форма не открывается. */
export function holdWindow<T>(job: Promise<T>): Promise<T> {
  running = job;
  return job;
}

export type Opened =
  | { readonly kind: 'form'; readonly form: AtsForm; readonly facts: IdentityFacts }
  | { readonly kind: 'manual'; readonly reason: ManualApplyReason; readonly host: string };

export async function openForm(vacancyId: string, address: AtsAddress): Promise<Opened> {
  await running.catch(() => undefined);
  const facts = await loadAtsFacts();
  try {
    const report = await desktop.openAtsForm(vacancyId, address.url, address.board);
    if (!report) throw new Error('ats_no_answer');
    const form = formOf(report, address.host);
    return 'kind' in form ? form : { kind: 'form', form, facts };
  } catch (reason) {
    if (isUnknownForm(reason)) return { kind: 'manual', reason: 'other', host: address.host };
    throw reason;
  }
}

/** Прежнее нажатие: его итог показывается, второго не будет. */
export async function priorAttempt(vacancyId: string): Promise<AtsApplyState | null> {
  const attempt = await desktop.readAtsAttempt(vacancyId);
  if (!attempt) return null;
  await settleAtsConsents(attempt, serverConsentJournal);
  if (attempt.result === 'failed') return null;
  const host = URL.canParse(attempt.entryUrl) ? new URL(attempt.entryUrl).hostname : '';
  if (attempt.result !== 'sent') return { kind: 'unconfirmed', host };
  const pressedAtMs = attempt.startedAtMs;
  return { kind: 'sent', receipt: attempt.confirmation ?? { host, path: '', pressedAtMs } };
}

export async function mandateAccepted(): Promise<boolean> {
  const consents = await getAccountCapabilityConsents();
  return hasApplyMandate(
    consents.filter((item) => item.revokedAt === null).map((item) => item.versionId),
  );
}

export interface AtsSendInput {
  readonly vacancyId: string;
  readonly employer: string;
  readonly approved: ApprovedVacancyLetterResult;
  readonly letterText: string;
  readonly draft: AnswerDraft;
}

/** Заполнить открытую форму и нажать её кнопку. */
export async function sendSession(
  { form, facts }: AtsSession,
  { vacancyId, employer, approved, letterText, draft }: AtsSendInput,
): Promise<AtsRunResult> {
  const needsFile = allFields(form).some((field) => isResumeFile(field));
  const resume = needsFile
    ? await loadAtsResume(vacancyId, approved.resume, facts.fullName ?? '')
    : null;
  const input = {
    vacancyId,
    applicationId: approved.applicationId,
    employer,
    letter: letterText,
    facts,
    resume,
    draft,
    now: () => new Date(),
  };
  return runAtsForm(form, input, DEPS);
}
