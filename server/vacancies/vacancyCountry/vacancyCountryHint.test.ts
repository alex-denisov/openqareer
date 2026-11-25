import { describe, expect, it } from 'vitest';
import { dominantEmployerCountry, vacancyCountryHint } from './vacancyCountryHint';

const PLACES: Readonly<Record<string, string>> = { zürich: 'CH', 'mclean, va': 'US', berlin: 'DE' };
const hint = (location: string | null, urls: readonly string[] = [], employer?: string) =>
  vacancyCountryHint(
    { location, company: 'Acme', urls },
    {
      resolvePlace: (place) => PLACES[place.toLowerCase()],
      employerCountry: () => employer,
    },
  );

describe('vacancyCountryHint', () => {
  it.each([
    ['Сербия', 'RS'],
    ['Anywhere in France', 'FR'],
    ['8038 Zürich, ZH', 'CH'],
    ['10178 Berlin', 'DE'],
    ['Hong Kong SAR', 'HK'],
    ['Atlanta, Georgia', 'US'],
    ['Georgia, United States', 'US'],
    ['Tbilisi, Georgia', 'GE'],
    ['Springfield, Illinois', 'US'],
    ['Virginia, South Africa', 'ZA'],
  ])('reads the place of %s', (location, country) => {
    expect(hint(location)).toEqual({ country, basis: 'place', lowConfidence: false });
  });

  it('two countries are no country', () => {
    expect(hint('Argentina; Brazil')).toBeUndefined();
    expect(hint('Georgia')).toBeUndefined();
    expect(hint('Remote')).toBeUndefined();
  });

  it('reads the Workday address, then the employer, then the domain', () => {
    const workday = 'https://acme.wd1.myworkdayjobs.com/Jobs/job/McLean-VA/Director_R1';
    expect(hint('4 Locations', [workday], 'DE')).toEqual({
      country: 'US',
      basis: 'address',
      lowConfidence: false,
    });
    expect(hint(null, ['https://acme.fr/jobs/1'], 'DE')).toEqual({
      country: 'DE',
      basis: 'employer',
      lowConfidence: false,
    });
    expect(hint(null, ['https://acme.co.uk/jobs/1'])).toEqual({
      country: 'GB',
      basis: 'domain',
      lowConfidence: false,
    });
  });

  it('reads the description last, marks it and never reads an object key', () => {
    const read = (text: string, employer?: string) =>
      vacancyCountryHint(
        { location: 'Remote', company: 'Acme', urls: [], text },
        { resolvePlace: () => undefined, employerCountry: () => employer },
      );
    expect(read('Our team in South Korea and Japan')).toEqual({
      country: 'KR',
      basis: 'text',
      lowConfidence: true,
    });
    expect(read('Our team in Japan', 'DE')?.basis).toBe('employer');
    expect(read('Constructor and Prototype')).toBeUndefined();
  });

  it('a board or a generic domain says nothing', () => {
    expect(hint('Remote', ['https://hh.ru/vacancy/1', 'https://acme.io/1'])).toBeUndefined();
    expect(hint('Remote', ['https://acme.ai/1', 'not a url'])).toBeUndefined();
  });
});

describe('dominantEmployerCountry', () => {
  it('needs three vacancies and four of five in one country', () => {
    expect(dominantEmployerCountry(new Map([['US', 2]]))).toBeUndefined();
    expect(
      dominantEmployerCountry(
        new Map([
          ['US', 9],
          ['IN', 1],
        ]),
      ),
    ).toBe('US');
    expect(
      dominantEmployerCountry(
        new Map([
          ['US', 5],
          ['IN', 5],
        ]),
      ),
    ).toBeUndefined();
  });
});
