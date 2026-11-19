import { evaluateCountryFit, getCountryMobilityData } from '../../../../shared/countryFit';
import type { CountryFitEvaluation } from '../../../../shared/countryFit/types';
import { SALARY_COUNTRY_CITIES } from '../../../../shared/salaryCountryCities';
import { supportedCountryCodes } from '../../../../shared/taxData';
import { apiFetch, readData } from '../../coach/apiClient';
import { getCandidateCampaign } from '../../coach/matchedVacancyApi';
import { getRelocationQuestionnaire } from '../../relocation/relocationApi';
import { mobilityCandidateFromQuestionnaire } from '../../relocation/relocationCountryData';

const PAY_API = '/api/v1/candidate/career/relocation/pay';

export type CountryPay =
  | {
      readonly state: 'ready';
      readonly currency: string;
      readonly low: number;
      readonly median: number;
      readonly high: number;
      readonly sampleSize: number;
      readonly observedAt: string;
      readonly rateDate: string | null;
      readonly sources: readonly string[];
      readonly vacancies: number;
      readonly city: string | null;
    }
  | { readonly state: 'thin'; readonly vacancies: number; readonly city: string | null }
  | { readonly state: 'error' };

export interface RelocationPlace {
  readonly code: string;
  readonly name: string;
  readonly pay: CountryPay;
  readonly fit: CountryFitEvaluation;
}

export interface RelocationData {
  readonly places: readonly RelocationPlace[];
  readonly role: string | null;
  /** Компании, которые оплачивают переезд; `null` — список не прочитан. */
  readonly companies: number | null;
}

/** Страны, где есть и вакансии каталога по городам, и проверенная налоговая шкала. */
export const PAY_COUNTRIES: readonly string[] = Object.keys(SALARY_COUNTRY_CITIES).filter((code) =>
  supportedCountryCodes.some((supported) => supported === code),
);

export async function getCountryPay(code: string, signal?: AbortSignal): Promise<CountryPay> {
  return readData<CountryPay>(
    await apiFetch(`${PAY_API}?country=${encodeURIComponent(code)}`, { signal }),
  );
}

async function relocationCompanies(signal: AbortSignal): Promise<number | null> {
  const response = await apiFetch('/api/v1/companies?relocation=true&limit=1', { signal });
  if (!response.ok) return null;
  const body = (await response.json()) as { total?: unknown };
  return typeof body.total === 'number' ? body.total : null;
}

/** Выбранные в анкете страны с расчётом; без выбора — все страны с расчётом. */
function placeCodes(selected: readonly string[] | undefined): readonly string[] {
  const chosen = PAY_COUNTRIES.filter((code) => selected?.includes(code));
  return chosen.length > 0 ? chosen : PAY_COUNTRIES;
}

export async function loadRelocation(signal: AbortSignal): Promise<RelocationData> {
  const [questionnaire, campaign, companies] = await Promise.all([
    getRelocationQuestionnaire(signal).catch(() => null),
    getCandidateCampaign(signal).catch(() => null),
    relocationCompanies(signal).catch(() => null),
  ]);
  const profile = questionnaire?.profile ?? null;
  const candidate = mobilityCandidateFromQuestionnaire(profile);
  const codes = placeCodes(profile?.selectedCountryCodes);
  const places = await Promise.all(
    codes.map(async (code) => ({
      code,
      name: getCountryMobilityData(code).name,
      pay: await getCountryPay(code, signal).catch((): CountryPay => ({ state: 'error' })),
      fit: evaluateCountryFit(code, candidate),
    })),
  );
  return { places, role: campaign?.roles.value[0] ?? null, companies };
}
