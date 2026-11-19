/** B593: тема и валюта показа сумм нового кабинета — выбор кандидата, общий для его устройств. */
export const APP_THEMES = ['light', 'dark', 'system'] as const;
export const MONEY_CURRENCIES = ['RUB', 'USD', 'EUR', 'AED'] as const;

export type AppTheme = (typeof APP_THEMES)[number];
export type AppMoneyCurrency = (typeof MONEY_CURRENCIES)[number];

export interface B640AppPreferences {
  /** `null` — кандидат ещё не выбирал. */
  readonly theme: AppTheme | null;
  readonly moneyCurrency: AppMoneyCurrency | null;
}
