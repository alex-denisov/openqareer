/** B803: страны-соседи по рынку труда: доноры для поправки госданных и для региона источников. */
const GROUPS: readonly (readonly string[])[] = [
  ['AE', 'SA', 'QA', 'KW', 'OM', 'BH'],
  ['AT', 'BE', 'CH', 'DE', 'DK', 'FI', 'FR', 'GB', 'IE', 'LU', 'NL', 'NO', 'SE'],
  ['CY', 'ES', 'GR', 'IT', 'MT', 'PT'],
  ['BG', 'CZ', 'EE', 'HR', 'HU', 'LT', 'LV', 'PL', 'RO', 'SI', 'SK'],
  ['AM', 'AZ', 'BY', 'GE', 'KG', 'KZ', 'MD', 'RU', 'TJ', 'UA', 'UZ'],
  ['ID', 'KH', 'LA', 'MY', 'PH', 'TH', 'VN'],
  ['BD', 'IN', 'LK', 'NP', 'PK'],
  ['AU', 'CA', 'GB', 'NZ', 'US'],
  ['HK', 'JP', 'KR', 'SG', 'TW', 'MO'],
  ['CN', 'MY', 'TH', 'VN'],
  ['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'MX', 'PE', 'PY', 'UY'],
  ['CR', 'DO', 'GT', 'HN', 'MX', 'NI', 'PA', 'SV'],
  ['DZ', 'EG', 'JO', 'LB', 'MA', 'TN', 'TR'],
  ['GH', 'KE', 'NG', 'RW', 'TZ', 'UG', 'ZA', 'ZM'],
];

export function neighbourCountries(country: string): readonly string[] {
  const group = GROUPS.find((codes) => codes.includes(country));
  return group ? group.filter((code) => code !== country) : [];
}

export const GULF_COUNTRIES: ReadonlySet<string> = new Set(GROUPS[0]);

const REGION_COUNTRIES: Readonly<Record<string, readonly string[]>> = {
  us: ['US'],
  ru: ['RU'],
  cis: ['AM', 'AZ', 'BY', 'GE', 'KG', 'KZ', 'MD', 'TJ', 'TM', 'UA', 'UZ'],
  eu: [...GROUPS[1]!, ...GROUPS[2]!, ...GROUPS[3]!],
  mena: [...GROUPS[0]!, 'DZ', 'EG', 'IL', 'JO', 'LB', 'MA', 'TN', 'TR'],
  apac: [...GROUPS[5]!, ...GROUPS[6]!, ...GROUPS[8]!, 'CN', 'AU', 'NZ'],
  latam: [...GROUPS[10]!, ...GROUPS[11]!],
};

export function regionOfCountry(country: string): string | undefined {
  return Object.entries(REGION_COUNTRIES).find(([, codes]) => codes.includes(country))?.[0];
}
