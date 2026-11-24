/** B787: журнал согласий, которые OpenQareer подтвердил за кандидата по его поручению. */
export const APPLY_CONSENT_RESULTS = ['sent', 'failed', 'unconfirmed'] as const;
export type ApplyConsentResult = (typeof APPLY_CONSENT_RESULTS)[number];

export interface ApplyConsentInput {
  /** UUID попытки: повтор запроса не создаёт вторую запись. */
  readonly id: string;
  readonly applicationId: string | null;
  readonly host: string;
  readonly employer: string;
  /** Текст галочки дословно, как на странице. */
  readonly checkboxText: string;
  readonly policyUrl: string | null;
  /** SHA-256 текста политики; `null` — политика не прочиталась. */
  readonly policySha256: string | null;
  /** Видимая подпись у галочки на форме (label); `null` — её нет. */
  readonly checkboxLabel: string | null;
  /** Команда кандидата, по которой ушёл отклик. */
  readonly command: string;
}

export interface ApplyConsentEntry extends ApplyConsentInput {
  readonly mandateVersion: string;
  /** Время UTC по часам сервера. */
  readonly occurredAt: string;
  readonly results: readonly { readonly result: ApplyConsentResult; readonly at: string }[];
}

export interface ApplyConsentPage {
  readonly entries: readonly ApplyConsentEntry[];
  readonly total: number;
}
