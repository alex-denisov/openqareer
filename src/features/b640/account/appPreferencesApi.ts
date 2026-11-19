import type { B640AppPreferences } from '../../../../shared/b640AppPreferences';
import { apiFetch, readData } from '../../coach/apiClient';

const URL = '/api/v1/candidate/b640/app-preferences';
const EMPTY: B640AppPreferences = { theme: null, moneyCurrency: null };

/** Один запрос на страницу: n06 и «Вакансии» читают одно и то же. */
let cached: Promise<B640AppPreferences> | null = null;

export function getAppPreferences(): Promise<B640AppPreferences> {
  cached ??= apiFetch(URL)
    .then((response) => readData<B640AppPreferences>(response))
    .catch((error: unknown) => {
      cached = null;
      throw error;
    });
  return cached;
}

/** Валюта показа сумм; не прочиталась — `null`, экран берёт свою по умолчанию. */
export function preferredMoneyCurrency(): Promise<B640AppPreferences['moneyCurrency']> {
  return getAppPreferences().then((prefs) => prefs.moneyCurrency, () => EMPTY.moneyCurrency);
}

export async function saveAppPreferences(
  patch: Partial<{ [K in keyof B640AppPreferences]: NonNullable<B640AppPreferences[K]> }>,
): Promise<B640AppPreferences> {
  const response = await apiFetch(URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const saved = await readData<B640AppPreferences>(response);
  cached = Promise.resolve(saved);
  return saved;
}
