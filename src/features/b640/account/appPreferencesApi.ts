import type { B640AppPreferences } from '../../../../shared/b640AppPreferences';
import { apiFetch, readData } from '../../coach/apiClient';

const URL = '/api/v1/candidate/b640/app-preferences';

let inflight: Promise<B640AppPreferences> | null = null;

/**
 * Без кэша между экранами: после выхода и входа другого кандидата прежний выбор не всплывёт.
 * Одновременные чтения (тема кабинета и экран n06 при открытии) делят один запрос.
 */
export function getAppPreferences(): Promise<B640AppPreferences> {
  inflight ??= apiFetch(URL)
    .then((response) => readData<B640AppPreferences>(response))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Валюта показа сумм; не прочиталась — `null`, экран берёт свою по умолчанию. */
export function preferredMoneyCurrency(): Promise<B640AppPreferences['moneyCurrency']> {
  return getAppPreferences().then(
    (prefs) => prefs.moneyCurrency,
    () => null,
  );
}

/** B593: тема кандидата при открытии кабинета; не прочиталась — `null`, остаётся тема устройства. */
export function preferredTheme(): Promise<B640AppPreferences['theme']> {
  return getAppPreferences().then(
    (prefs) => prefs.theme,
    () => null,
  );
}

export async function saveAppPreferences(
  patch: Partial<{ [K in keyof B640AppPreferences]: NonNullable<B640AppPreferences[K]> }>,
): Promise<B640AppPreferences> {
  const response = await apiFetch(URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return readData<B640AppPreferences>(response);
}
