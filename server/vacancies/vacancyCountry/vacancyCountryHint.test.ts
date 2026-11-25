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
    ['Georgia, United States', 'US'],
    ['Springfield, Illinois', 'US'],
    ['Virginia, South Africa', 'ZA'],
    ['Lebanon, NH', 'US'],
    ['Peru, IN', 'US'],
    ['Peru, IN, United States', 'US'],
    ['Jordan, Minnesota', 'US'],
    ['London, Ohio', 'US'],
    ['Moscow, WA', 'US'],
    ['London, ON', 'CA'],
    ['Amsterdam, NH, Netherlands', 'NL'],
    ['New York, NY', 'US'],
    ['Austin, TX; Seattle, Washington', 'US'],
  ])('reads the place of %s', (location, country) => {
    expect(hint(location)).toEqual({ country, basis: 'place', lowConfidence: false });
  });

  it.each([
    ['Friedrichshafen', 'DE'],
    ['Atlanta, Georgia', 'US'],
    ['Tbilisi, Georgia', 'GE'],
    ['Perth, WA', 'AU'],
    ['Windsor, CA', 'CA'],
    ['Hyderabad, IN', 'IN'],
    ['Moscow, ID', 'US'],
    ['Dublin, CA', 'US'],
    ['Cambridge, MA', 'US'],
    ['San Jose, CA', 'US'],
    ['Santa Clara, CA', 'US'],
    ['Birmingham, AL', 'US'],
    ['Milano, MI', 'IT'],
    ['Rotterdam, NL', 'NL'],
    ['Bengaluru, IN', 'IN'],
    ['Palo Alto, CA', 'US'],
    ['Toronto; Vancouver', 'CA'],
  ])('a dictionary city is a separate basis: %s', (location, country) => {
    expect(hint(location, [], 'FR')).toEqual({ country, basis: 'city', lowConfidence: false });
  });

  it('regions and common words are not cities', () => {
    for (const location of [
      ...['Latin America', 'North America', 'South America', 'Asia', 'Asia Pacific'],
      ...['Pacific Time', 'Field Sales', 'Center', 'Union', 'Victoria'],
    ]) {
      expect(hint(location)).toBeUndefined();
    }
    expect(hint('Macedonia')?.country).toBe('MK');
  });

  it('two countries are no country', () => {
    expect(hint('Argentina; Brazil')).toBeUndefined();
    for (const location of [
      'Texas; London',
      'Delaware; Toronto',
      'London / New York',
      'London, New York',
      'New York; Berlin; Toronto',
      'Canada, Texas',
      'Warsaw, IN',
      'Berlin, London',
      'New York or London',
      'Москва, Минск',
    ]) {
      expect(hint(location, [], 'DE')).toBeUndefined();
    }
    expect(hint('Georgia')).toBeUndefined();
    expect(hint('Remote')).toBeUndefined();
  });

  it('a code of two countries leaves the choice between them to the next signs', () => {
    for (const city of ['Vancouver', 'Hamilton', 'Burlington', 'Richmond', 'Victoria']) {
      expect(hint(`${city}, CA`, [], 'CA')).toMatchObject({ country: 'CA', basis: 'employer' });
      expect(hint(`${city}, CA`, [], 'US')).toMatchObject({ country: 'US', basis: 'employer' });
    }
    for (const place of ['Vancouver, CA', 'Hamilton, CA'])
      expect(hint(place, [], 'DE')).toEqual({ country: 'CA', basis: 'city', lowConfidence: true });
    expect(hint('Nowhereville, CA', [], 'US')?.country).toBe('US');
    for (const place of ['Salem, IN', 'Mobile, AL'])
      expect(hint(place, ['https://acme.ca/1'], 'CA')?.country).not.toBe('CA');
    expect(hint('Vancouver, CA; Berlin', [], 'CA')).toBeUndefined();
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
    for (const host of [
      'youtu.be',
      'lnkd.in',
      'acme.recruitee.nl',
      'www.adzuna.de',
      'stepstone.de',
    ])
      expect(hint('Remote', [`https://${host}/1`])).toBeUndefined();
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
