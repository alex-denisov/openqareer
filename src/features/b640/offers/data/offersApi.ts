import type {
  B640OfferDecision,
  B640OfferDecisionResult,
  B640OfferView,
} from '../../../../../shared/b640Offers';
import type { CurrencyRates } from '../../../../../shared/currencyRates';
import { listApplicationOffers, listApplicationsPool } from '../../../applications/applicationsApi';
import { apiFetch, readData, readDataArray } from '../../../coach/apiClient';
import { getCurrencyRates } from '../../../coach/coachApi';
import { getDecisionProfile } from '../../../coach/decisionProfileApi';
import { buildOfferCards, type OfferCard, type SalaryFloor } from '../model/offerModel';

const OFFERS = '/api/v1/candidate/b640/offers';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export interface OffersData {
  readonly cards: readonly OfferCard[];
  readonly rates: CurrencyRates | null;
  readonly floor: SalaryFloor | null;
}

/** B680: офферы со сроком ответа, налогом и решением кандидата. */
export async function getB640Offers(signal?: AbortSignal): Promise<B640OfferView[]> {
  return readDataArray<B640OfferView>(await apiFetch(OFFERS, { signal }));
}

/** Курс и планка — дополнение: без них экран показывает суммы как есть. */
async function optional<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

async function salaryFloor(signal: AbortSignal): Promise<SalaryFloor | null> {
  const profile = await optional(() => getDecisionProfile(signal));
  if (!profile?.salaryFloor) return null;
  return { amount: profile.salaryFloor, currency: profile.salaryCurrency ?? 'RUB' };
}

/** Всё для экрана «Офферы»: офферы, условия, названия откликов, курс ЦБ и планка. */
export async function loadOffers(signal: AbortSignal): Promise<OffersData> {
  const [views, stored, pool, rates, floor] = await Promise.all([
    getB640Offers(signal),
    listApplicationOffers(),
    listApplicationsPool({}, signal),
    optional(() => getCurrencyRates()),
    salaryFloor(signal),
  ]);
  return { cards: buildOfferCards(pool.items, stored, views), rates, floor };
}

export async function putOfferTax(applicationId: string, taxPercent: number | null): Promise<B640OfferView> {
  const response = await apiFetch(`${OFFERS}/${encodeURIComponent(applicationId)}/tax`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ taxPercent }),
  });
  return readData<B640OfferView>(response);
}

/** `null` — «Думаю»: снять записанное решение. */
export async function putOfferDecision(
  applicationId: string,
  decision: B640OfferDecision | null,
): Promise<B640OfferDecisionResult> {
  const response = await apiFetch(`${OFFERS}/${encodeURIComponent(applicationId)}/decision`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ decision }),
  });
  return readData<B640OfferDecisionResult>(response);
}
