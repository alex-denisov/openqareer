import type { ApplyConsentInput, ApplyConsentResult } from '../../../../../shared/applyConsent';
import type { AtsConsentJournal } from './atsConsentJournal';
import { submitAtsForm } from './atsDesktop';
import type { AtsConsentRecord } from './atsFieldPlan';
import type { AtsAttempt, AtsReceipt } from './atsFormTypes';

export interface AtsSendInput {
  readonly vacancyId: string;
  readonly applicationId: string | null;
  readonly employer: string;
  /** Команда кандидата, по которой уходит отклик. */
  readonly command: string;
  readonly values: Readonly<Record<string, string>>;
  readonly consents: readonly AtsConsentRecord[];
}

export interface AtsSendDeps {
  readonly journal: AtsConsentJournal;
  readonly submit: typeof submitAtsForm;
  readonly newId: () => string;
}

export type AtsSendResult =
  | { readonly kind: 'receipt'; readonly receipt: AtsReceipt }
  /** Согласие не записалось: кнопка не нажата. */
  | { readonly kind: 'consent_unrecorded' }
  /** Не в приложении или ответ команды потерян: итог нажатия неизвестен. */
  | { readonly kind: 'unknown' };

function consentInput(
  input: AtsSendInput,
  consent: AtsConsentRecord,
  id: string,
): ApplyConsentInput {
  return {
    id,
    applicationId: input.applicationId,
    host: consent.host,
    employer: input.employer,
    checkboxText: consent.text,
    policyUrl: consent.link,
    policySha256: null,
    checkboxLabel: consent.text,
    command: input.command,
  };
}

function resultOf(receipt: AtsReceipt): ApplyConsentResult {
  if (receipt.outcome === 'confirmed') return 'sent';
  const notPressed = receipt.outcome === 'captcha' && receipt.pressedAtMs === null;
  const refused = receipt.outcome === 'rejected' || receipt.outcome === 'not_submitted';
  return refused || notPressed ? 'failed' : 'unconfirmed';
}

/** Сбой записи итога отклик не меняет: запись остаётся без итога, его допишет `settleAtsConsents`. */
async function settle(
  journal: AtsConsentJournal,
  ids: readonly string[],
  result: ApplyConsentResult,
): Promise<void> {
  await Promise.allSettled(ids.map((id) => journal.result(id, result)));
}

/** Согласия → журнал, затем одно нажатие, затем итог. Нет записи о согласии — нет нажатия. */
export async function sendAtsForm(input: AtsSendInput, deps: AtsSendDeps): Promise<AtsSendResult> {
  const entries = input.consents.map((consent) => consentInput(input, consent, deps.newId()));
  const consentIds = entries.map((entry) => entry.id);
  const recorded = await Promise.allSettled(entries.map((entry) => deps.journal.record(entry)));
  if (recorded.some((outcome) => outcome.status === 'rejected')) {
    await settle(deps.journal, consentIds, 'failed');
    return { kind: 'consent_unrecorded' };
  }
  const attempt = { id: deps.newId(), consentIds };
  const receipt = await deps.submit(input.vacancyId, input.values, attempt).catch(() => null);
  // Код ещё не введён: итог согласия пишется, когда он станет известен.
  if (receipt?.outcome !== 'code')
    await settle(deps.journal, consentIds, receipt ? resultOf(receipt) : 'unconfirmed');
  return receipt ? { kind: 'receipt', receipt } : { kind: 'unknown' };
}

/** После перезапуска: дописать итог согласиям прерванной попытки. */
export async function settleAtsConsents(
  attempt: AtsAttempt,
  journal: AtsConsentJournal,
): Promise<void> {
  await settle(journal, attempt.consentIds, attempt.result ?? 'unconfirmed');
}
