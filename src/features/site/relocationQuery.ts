/**
 * B354: the relocation answers live in the page address, so a copied link opens the same estimate.
 * Every field is validated; a link with any invalid field opens the questionnaire from scratch.
 */
import {
  RELOCATION_ENGLISH,
  RELOCATION_FAMILY,
  RELOCATION_MAX_COUNTRIES,
  RELOCATION_PROFESSIONS,
  type RelocationAnswers,
} from '../../../shared/countryFit/relocationEstimate';
import { getCountryTaxData } from '../../../shared/taxData';
import { COUNTRY_CODES } from './countryFitScenario';

export const RELOCATION_PATH = '/tools/relocation';
export const RELOCATION_CITIZENSHIPS = ['RU', 'BY', 'KZ', 'UZ', 'AM', 'other'] as const;
export const RELOCATION_CURRENCIES: readonly string[] = [
  ...new Set(['EUR', ...COUNTRY_CODES.map((code) => getCountryTaxData(code).currency)]),
];
const MAX_NET_MONTHLY = 100_000_000;

function oneOf<T extends string>(list: readonly T[], value: string | null): T | undefined {
  return list.find((item) => item === value);
}

function wholeNumber(value: string | null, max: number): number | undefined {
  if (value === null || !/^\d{1,9}$/u.test(value)) return undefined;
  const number = Number(value);
  return number <= max ? number : undefined;
}

export function parseRelocationQuery(search: string): RelocationAnswers | undefined {
  const params = new URLSearchParams(search);
  const citizenship = oneOf(RELOCATION_CITIZENSHIPS, params.get('c'));
  const profession = oneOf(RELOCATION_PROFESSIONS, params.get('p'));
  const experienceYears = wholeNumber(params.get('x'), 50);
  const degree = params.get('d');
  const english = oneOf(RELOCATION_ENGLISH, params.get('en'));
  const family = oneOf(RELOCATION_FAMILY, params.get('f'));
  const netMonthly = wholeNumber(params.get('net'), MAX_NET_MONTHLY);
  const netCurrency = oneOf(RELOCATION_CURRENCIES, params.get('cur'));
  const countries = (params.get('to') ?? '').split(',').filter(Boolean);
  const countriesValid =
    countries.length > 0 &&
    countries.length <= RELOCATION_MAX_COUNTRIES &&
    new Set(countries).size === countries.length &&
    countries.every((code) => (COUNTRY_CODES as readonly string[]).includes(code));
  if (
    !citizenship ||
    !profession ||
    experienceYears === undefined ||
    (degree !== '0' && degree !== '1') ||
    !english ||
    !family ||
    !netMonthly ||
    !netCurrency ||
    !countriesValid
  ) {
    return undefined;
  }
  return {
    citizenship,
    profession,
    experienceYears,
    hasDegree: degree === '1',
    english,
    family,
    netMonthly,
    netCurrency,
    countries,
  };
}

export function relocationQuery(answers: RelocationAnswers): string {
  const params = new URLSearchParams({
    c: answers.citizenship,
    p: answers.profession,
    x: String(answers.experienceYears),
    d: answers.hasDegree ? '1' : '0',
    en: answers.english,
    f: answers.family,
    net: String(Math.round(answers.netMonthly)),
    cur: answers.netCurrency,
    to: answers.countries.join(','),
  });
  return `?${params.toString()}`;
}
