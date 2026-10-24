import { northAmericanCountryOf } from '../../shared/postalPlace';
import type { SalaryMarketLocation } from '../../shared/salaryMarketSnapshot';
import { countryCodeFromNameOrCode, countryNameFromCode } from '../domain/geoCoordinates';
import { regionOfVacancy } from '../vacancies/vacancyGeography';

export const SALARY_GEOGRAPHY_COHORT_VERSION = 'geography-explicit-country-v1';
export const SALARY_REGIONAL_LOCATIONS = ['remote', 'europe', 'uae', 'cis'] as const;
export type SalaryRegionalLocation = (typeof SALARY_REGIONAL_LOCATIONS)[number];
export interface SalaryGeographyClassification {
  readonly status: 'explicit_country' | 'unknown_country' | 'ambiguous_country';
  readonly countryCode?: string;
  readonly locations: readonly SalaryRegionalLocation[];
}

/** Only source-location country literals/codes. No city, company, salary or language inference. */
export function salaryGeography(
  location: string | null,
  isRemote: boolean,
): SalaryGeographyClassification {
  const locations: SalaryRegionalLocation[] = isRemote ? ['remote'] : [];
  if (!location || location.length > 2000) return { status: 'unknown_country', locations };
  const tokens = location
    .split(/[,|()/;]+|\s+-\s+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length > 32) return { status: 'unknown_country', locations };
  const codes = new Set<string>();
  const countryRegions = new Map<string, ReturnType<typeof regionOfVacancy>>();
  const ambiguous = new Set<string>();
  for (const token of tokens) {
    const postal = northAmericanCountryOf(token);
    const code = countryCodeFromNameOrCode(token);
    // "Chicago, IL", "Atlanta, Georgia", "CA" do not establish an applicant country.
    if (postal || token.toLowerCase() === 'georgia') {
      ambiguous.add(code ?? (postal === 'Canada' ? 'CA' : 'US'));
    } else if (code) {
      codes.add(code);
      countryRegions.set(code, regionOfVacancy({ country: countryNameFromCode(code) }));
    }
  }
  const country = codes.size === 1 ? [...codes][0]! : undefined;
  if (
    codes.size > 1 ||
    (ambiguous.size > 0 &&
      (!country ||
        (country !== 'US' && country !== 'CA' && [...ambiguous].some((code) => code !== country))))
  ) {
    return { status: 'ambiguous_country', locations };
  }
  if (!country) return { status: 'unknown_country', locations };
  const region = countryRegions.get(country);
  if (country === 'AE') locations.push('uae');
  else if (region === 'eu') locations.push('europe');
  else if (region === 'cis') locations.push('cis');
  return { status: 'explicit_country', countryCode: country, locations };
}

/** Scope identity is separate from global history and versioned when geography semantics change. */
export function salaryLocationCohortKey(role: string, location: SalaryMarketLocation): string {
  return location === 'all' ? role : `${role}|${SALARY_GEOGRAPHY_COHORT_VERSION}:${location}`;
}
