import { evaluateCountryFit, getCountryMobilityData } from '../../../../shared/countryFit';
import type { CountryFitEvaluation } from '../../../../shared/countryFit/types';
import { SALARY_COUNTRY_CITIES } from '../../../../shared/salaryCountryCities';
import { supportedCountryCodes } from '../../../../shared/taxData';
import { apiFetch, readData } from '../../coach/apiClient';
import { getCandidateCampaign } from '../../coach/matchedVacancyApi';
import {
  getRelocationQuestionnaire,
  type RelocationQuestionnaireResponse,
} from '../../relocation/relocationApi';
import type { SavedRelocationScenario } from '../../../../shared/relocationScenario';
import { latestScenarios } from './relocationCostsApi';
import type { CostKey } from './relocationCostsModel';
import {
  choiceKey,
  getCityPay,
  getRussianCities,
  getSavedPlaces,
  type CityPay,
  type PlaceChoice,
  type RussianCity,
} from './relocationPlacesApi';
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
  /** `country:RS` или `city:kazan` — как в сохранённом списке мест. */
  readonly key: string;
  readonly kind: 'country' | 'city';
  /** Код страны для налогов и расчёта; у города России — RU. */
  readonly code: string;
  readonly name: string;
  readonly pay: CountryPay;
  /** Право работать по правилам страны; у города России визы нет — `null`. */
  readonly fit: CountryFitEvaluation | null;
  /** Разделы трат «Не про меня». */
  readonly skipped: readonly CostKey[];
}

export interface RelocationData {
  readonly places: readonly RelocationPlace[];
  readonly role: string | null;
  /** B737: русские названия ролей поиска; `role` остаётся ключом зарплат. */
  readonly titlesRu: Readonly<Record<string, string>>;
  /** Компании, которые оплачивают переезд; `null` — список не прочитан. */
  readonly companies: number | null;
  /** Анкета релокации и согласие: «Кто едет» и запись трат. */
  readonly questionnaire: RelocationQuestionnaireResponse | null;
  /** Последний расчёт трат каждого места, по `scenarioKey`. */
  readonly scenarios: ReadonlyMap<string, SavedRelocationScenario>;
  /** Список мест, из которого построены строки; `saved` — выбран кандидатом. */
  readonly choices: readonly PlaceChoice[];
  readonly saved: boolean;
  /** Города России с вакансиями — для выбора мест. */
  readonly cities: readonly RussianCity[];
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
function defaultChoices(selected: readonly string[] | undefined): PlaceChoice[] {
  const chosen = PAY_COUNTRIES.filter((code) => selected?.includes(code));
  return (chosen.length > 0 ? chosen : PAY_COUNTRIES).map((code) => ({
    kind: 'country',
    code,
    skipped: [],
  }));
}

function cityToPay(pay: CityPay, vacancies: number): CountryPay {
  if (pay.state !== 'ready') return { state: 'thin', vacancies, city: null };
  return {
    state: 'ready',
    currency: pay.currency,
    low: pay.low,
    median: pay.median,
    high: pay.high,
    sampleSize: pay.sampleSize,
    observedAt: pay.observedAt,
    rateDate: null,
    sources: [],
    vacancies,
    city: null,
  };
}

interface PlaceContext {
  readonly role: string | null;
  readonly cities: readonly RussianCity[];
  readonly candidate: ReturnType<typeof mobilityCandidateFromQuestionnaire>;
  readonly signal: AbortSignal;
}

async function placeOf(choice: PlaceChoice, context: PlaceContext): Promise<RelocationPlace> {
  const base = { key: choiceKey(choice), skipped: choice.skipped };
  if (choice.kind === 'country')
    return {
      ...base,
      kind: 'country',
      code: choice.code,
      name: getCountryMobilityData(choice.code).name,
      pay: await getCountryPay(choice.code, context.signal).catch((): CountryPay => ({
        state: 'error',
      })),
      fit: evaluateCountryFit(choice.code, context.candidate),
    };
  const city = context.cities.find((item) => item.slug === choice.slug);
  const name = city?.name ?? choice.slug;
  return {
    ...base,
    kind: 'city',
    code: 'RU',
    name,
    pay: await getCityPay(name, context.role, context.signal)
      .then((pay) => cityToPay(pay, city?.vacancies ?? 0))
      .catch((): CountryPay => ({ state: 'error' })),
    fit: null,
  };
}

export async function loadRelocation(signal: AbortSignal): Promise<RelocationData> {
  const [questionnaire, campaign, companies, saved, cities] = await Promise.all([
    getRelocationQuestionnaire(signal).catch(() => null),
    getCandidateCampaign(signal).catch(() => null),
    relocationCompanies(signal).catch(() => null),
    getSavedPlaces(signal).catch(() => null),
    getRussianCities(signal).catch((): readonly RussianCity[] => []),
  ]);
  const scenarios = questionnaire?.consent.granted
    ? await latestScenarios()
    : new Map<string, SavedRelocationScenario>();
  const profile = questionnaire?.profile ?? null;
  const role = campaign?.roles.value[0] ?? null;
  const choices = saved?.saved ? saved.places : defaultChoices(profile?.selectedCountryCodes);
  const context = { role, cities, candidate: mobilityCandidateFromQuestionnaire(profile), signal };
  const places = await Promise.all(choices.map((choice) => placeOf(choice, context)));
  return {
    places,
    role,
    titlesRu: campaign?.titlesRu ?? {},
    companies,
    questionnaire,
    scenarios,
    choices,
    saved: Boolean(saved?.saved),
    cities,
  };
}
