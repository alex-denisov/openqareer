import type { AtsPlan } from './atsFieldPlan';
import type { AtsEntry, AtsFormReport, AtsReceipt } from './atsFormTypes';

/** B787: почему отклик не ушёл из приложения сам. Код читает очередь «нужен ваш шаг». */
export type AtsManualCode =
  | 'account'
  | 'captcha'
  | 'unknown_field'
  | 'rejected_form'
  | 'unconfirmed'
  | 'form_missing'
  | 'unreadable_form';

export interface AtsManualCase {
  readonly code: AtsManualCode;
  readonly host: string;
  /** Поля с готовыми ответами: кандидату не нужно собирать их заново. Файлы — только именем. */
  readonly prepared: readonly { readonly key: string; readonly value: string }[];
  /** Ключи полей, на которых остановилось: вопросы без ответа или отвергнутые формой. */
  readonly fieldKeys: readonly string[];
}

function prepared(entries: readonly AtsEntry[]): AtsManualCase['prepared'] {
  return entries.map((entry) => ({
    key: entry.key,
    value: entry.file ? entry.file.name : entry.value,
  }));
}

const READ_CODES: Partial<Record<AtsFormReport['state'], AtsManualCode>> = {
  account_required: 'account',
  captcha: 'captcha',
  form_missing: 'form_missing',
  off_target: 'unreadable_form',
  unreadable: 'unreadable_form',
};

/** До отправки: форма не читается, просит аккаунт или в плане остались вопросы. */
export function manualCaseBeforeSubmit(
  report: AtsFormReport,
  plan: AtsPlan | null,
): AtsManualCase | null {
  const entries = plan ? prepared(plan.entries) : [];
  const code = READ_CODES[report.state];
  if (code) return { code, host: report.host, prepared: entries, fieldKeys: [] };
  if (plan && plan.questions.length > 0) {
    const fieldKeys = plan.questions.map((item) => item.key);
    return { code: 'unknown_field', host: report.host, prepared: entries, fieldKeys };
  }
  return null;
}

const RECEIPT_CODES: Partial<Record<AtsReceipt['outcome'], AtsManualCode>> = {
  captcha: 'captcha',
  rejected: 'rejected_form',
  unconfirmed: 'unconfirmed',
  not_submitted: 'unreadable_form',
};

/** После нажатия: всё, кроме подтверждения доски, уходит в очередь; «отправлено» не пишется. */
export function manualCaseAfterSubmit(receipt: AtsReceipt, plan: AtsPlan): AtsManualCase | null {
  const code = RECEIPT_CODES[receipt.outcome];
  if (!code) return null;
  return {
    code,
    host: receipt.host,
    prepared: prepared(plan.entries),
    fieldKeys: receipt.invalidKeys,
  };
}
