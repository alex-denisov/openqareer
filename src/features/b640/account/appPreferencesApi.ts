import type { B640AppPreferences } from '../../../../shared/b640AppPreferences';
import { apiFetch, onApiWrite, readData } from '../../coach/apiClient';

const URL = '/api/v1/candidate/b640/app-preferences';

let inflight: Promise<B640AppPreferences> | null = null;
let fresh: { readonly value: B640AppPreferences; readonly at: number } | null = null;

/** Столько живёт ответ: оболочка и экран n06 при открытии читают его один раз (B773). */
const FRESH_MS = 10_000;

// Любая запись (сохранение, выход, вход другого кандидата) забывает ответ.
onApiWrite(() => {
  fresh = null;
});

/**
 * Между экранами кэша нет: ответ живёт 10 с и забывается при любой записи, поэтому после
 * выхода и входа другого кандидата прежний выбор не всплывёт. Одновременные чтения
 * (тема кабинета и экран n06 при открытии) и чтение сразу следом делят один запрос.
 */
export function getAppPreferences(): Promise<B640AppPreferences> {
  if (fresh && Date.now() - fresh.at < FRESH_MS) return Promise.resolve(fresh.value);
  inflight ??= apiFetch(URL)
    .then((response) => readData<B640AppPreferences>(response))
    .then((value) => {
      fresh = { value, at: Date.now() };
      return value;
    })
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
