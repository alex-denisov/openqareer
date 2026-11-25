import { describe, expect, it } from 'vitest';
import { marketSalaryCountry } from './marketSalaryCountry';

describe('marketSalaryCountry', () => {
  it.each([
    ['Lagos, , Nigeria', 'NG'],
    ['München', 'DE'],
    ['Berlin, DE', 'DE'],
    ['Sharjah', 'AE'],
    ['Abu Dhabi Emirate, United Arab Emirates', 'AE'],
    ['Chicago, IL', 'US'],
    ['Paris, TX', 'US'],
    ['San Francisco, CA', 'US'],
    ['Toronto, ON, CA', 'CA'],
    ['St. Petersburg, Florida', 'US'],
    ['Atlanta, Georgia', 'US'],
    ['Tbilisi, Georgia', 'GE'],
    ['US-CA-Menlo Park', 'US'],
    ['DE_Ulm, Remote', 'DE'],
    ['US Remote', 'US'],
    ['Germany (Remote)', 'DE'],
    ['Москва', 'RU'],
    ['Фокино (Брянская область)', 'RU'],
    ['Бишкек', 'KG'],
    ['London', 'GB'],
    ['Philippines', 'PH'],
    ['Amsterdam, NH, Netherlands', 'NL'],
    ['Leipzig, SN, Germany', 'DE'],
    ['Mumbai, MH, India', 'IN'],
    ['Hong Kong', 'HK'],
    ['London, England', 'GB'],
    ['London Office', 'GB'],
    ['Sydney', 'AU'],
    ['Севастополь', 'RU'],
    ['Брест', 'BY'],
    ['Київ', 'UA'],
    ['Boston, MA (Main Campus)', 'US'],
  ])('%s → %s', (location, code) => {
    expect(marketSalaryCountry(location)).toBe(code);
  });

  it.each([
    'Remote',
    'Remote, Europe',
    '2 Locations',
    'Germany (Remote) ; Ireland (Remote)',
    '',
    null,
  ])('не выводит страну из «%s»', (location) => {
    expect(marketSalaryCountry(location)).toBeUndefined();
  });
});
