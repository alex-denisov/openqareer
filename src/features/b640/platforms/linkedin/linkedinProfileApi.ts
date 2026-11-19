import { apiFetch, readData } from '../../../coach/apiClient';
import type { LinkedinDoneResult, LinkedinOffer, LinkedinProfileView } from '../../../../../shared/b640LinkedinProfile';

const BASE = '/api/v1/candidate/b640/linkedin/profile';

const post = (body: unknown = {}) =>
  ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) satisfies RequestInit;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  return readData<T>(await apiFetch(url, init));
}

/** Семь разделов: «сейчас» из импорта LinkedIn и предложения; без импорта — `no_import`. */
export const getLinkedinProfile = () => call<LinkedinProfileView>(BASE);

/** «Выполнено»: кандидат сам вставил тексты в LinkedIn; на LinkedIn ничего не уходит. */
export const markOffersDone = (keys: readonly string[]) => call<LinkedinDoneResult>(`${BASE}/done`, post({ keys }));

/** «Предложить заново»: другой вариант одного предложения, в счёт квоты тарифа. */
export const requestOfferVariant = (key: string) =>
  call<LinkedinOffer>(`${BASE}/offers/${encodeURIComponent(key)}/variant`, post());
