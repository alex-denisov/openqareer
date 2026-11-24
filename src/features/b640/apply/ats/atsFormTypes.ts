/** B787: форма работодателя, как её прочитало настольное приложение (src-tauri/src/ats_form.js). */
export type AtsFieldKind =
  | 'text'
  | 'textarea'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
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

/** Квитанция: что нажато, когда и что ответила доска. Значений полей в ней нет. */
export interface AtsReceipt {
  readonly outcome: AtsOutcome;
  readonly reason: string | null;
  readonly host: string;
  readonly path: string;
  readonly pressedAtMs: number | null;
  readonly fieldKeys: readonly string[];
  readonly invalidKeys: readonly string[];
}
