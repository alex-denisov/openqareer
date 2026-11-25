import type { NumberLimits } from '../../../../../shared/questionnaireNumber';

/** B787: форма работодателя, как её прочитало настольное приложение (src-tauri/src/ats_form.js). */
export type AtsFieldKind =
  | 'text'
  | 'textarea'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  /** Ползунок: значение — число. */
  | 'range'
  | 'date'
  | 'password'
  | 'select'
  | 'combobox'
  | 'radio'
  | 'checkbox'
  /** Несколько галочек одного вопроса; значение — варианты через перевод строки. */
  | 'checkbox_group'
  | 'file';

export interface AtsOption {
  readonly value: string;
  readonly label: string;
}

export interface AtsField {
  readonly key: string;
  readonly label: string;
  readonly kind: AtsFieldKind;
  readonly role: string | null;
  readonly required: boolean;
  /** Подсказка разметки (given-name, email, tel): не зависит от языка подписи. */
  readonly autocomplete?: string | null;
  readonly options: readonly AtsOption[];
  readonly accept: string | null;
  /** Границы числа у `number` и `range`. */
  readonly limits?: NumberLimits | null;
  /** Ссылка из подписи галочки: обычно политика работодателя. */
  readonly link: string | null;
}

export type AtsFormState =
  'ready' | 'account_required' | 'form_missing' | 'captcha' | 'off_target' | 'unreadable';

export interface AtsFormReport {
  readonly state: AtsFormState;
  readonly adapter: string;
  readonly host: string;
  readonly form: {
    readonly fields?: readonly AtsField[];
    readonly submitLabel?: string;
    /** 'next' — у формы есть следующий шаг: отправка на нём не нажимается. */
    readonly step?: 'next' | 'submit';
  };
}

export interface AtsFile {
  readonly name: string;
  readonly type: string;
  readonly base64: string;
}

export interface AtsEntry {
  readonly key: string;
  readonly value: string;
  readonly file?: AtsFile;
}

export interface AtsFillReport {
  readonly results: Readonly<Record<string, string>>;
  readonly values: Readonly<Record<string, string>>;
}

export type AtsOutcome = 'confirmed' | 'unconfirmed' | 'rejected' | 'captcha' | 'not_submitted';

/** Почему кнопка не нажата: закрытый список приложения, текста страницы в нём нет. */
export type AtsReason =
  | 'off_target'
  | 'not_confirmed'
  | 'already_submitted'
  | 'form_not_filled'
  | 'confirmed_values_differ'
  | 'form_changed'
  | 'attempt_unrecorded'
  | 'captcha'
  | 'submit_ambiguous'
  | 'submit_disabled'
  | 'form_missing'
  | 'press_unknown';

/** Попытка отправки на диске приложения: переживает перезапуск; `null` в итоге — он не узнан. */
export interface AtsAttempt {
  readonly id: string;
  readonly vacancyId: string;
  readonly entryUrl: string;
  readonly startedAtMs: number;
  readonly consentIds: readonly string[];
  readonly result: 'sent' | 'failed' | 'unconfirmed' | null;
  /** Квитанция: где и когда доска подтвердила отклик. */
  readonly confirmation?: AtsConfirmation;
}

export interface AtsConfirmation {
  readonly host: string;
  readonly path: string;
  readonly pressedAtMs: number | null;
}

/** Переход к следующей странице формы; кнопка отправки здесь не нажимается. */
export interface AtsStepReport {
  readonly state: 'moved' | 'invalid' | 'captcha' | 'not_moved';
  readonly reason: string | null;
  readonly invalidKeys: readonly string[];
  readonly form: AtsFormReport | null;
}

/** Квитанция: что нажато, когда и что ответила доска. Значений полей в ней нет. */
export interface AtsReceipt {
  readonly outcome: AtsOutcome;
  readonly reason: AtsReason | null;
  readonly host: string;
  readonly path: string;
  readonly pressedAtMs: number | null;
  readonly fieldKeys: readonly string[];
  readonly invalidKeys: readonly string[];
}
