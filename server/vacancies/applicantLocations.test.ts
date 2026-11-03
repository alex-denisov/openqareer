import { describe, expect, it } from 'vitest';
import { applicantCountries } from './applicantLocations';

describe('applicantCountries', () => {
  it('lists every country the source named, not only the last one', () => {
    expect(applicantCountries('Poland; Portugal; Spain; United Kingdom')).toEqual([
      'PL',
      'PT',
      'ES',
      'GB',
    ]);
    expect(applicantCountries('Remote (United States | Canada)')).toEqual(['US', 'CA']);
  });

  it('reads a country between dashes', () => {
    expect(applicantCountries('EMEA - France - Offsite/Home')).toEqual(['FR']);
  });

  it('expands a macro-region into its countries', () => {
    const latam = applicantCountries('LATAM');
    expect(latam).toContain('BR');
    expect(latam).toContain('MX');
    expect(latam).not.toContain('US');
    const emea = applicantCountries('Remote, EMEA');
    expect(emea).toEqual(expect.arrayContaining(['DE', 'GB', 'AE', 'ZA']));
    expect(applicantCountries('APAC')).toEqual(expect.arrayContaining(['AU', 'SG', 'JP']));
    expect(applicantCountries('Europe')).toEqual(expect.arrayContaining(['DE', 'PL', 'GB']));
  });

  it('falls back to a macro-region named in the title when the source gave no place', () => {
    expect(applicantCountries(undefined, 'Senior Software Engineer LATAM')).toContain('AR');
    expect(applicantCountries('Remote', 'Account Manager (EMEA)')).toContain('FR');
    // A word that only contains the letters is not the region.
    expect(applicantCountries(undefined, 'Platform Engineer')).toEqual([]);
  });

  it('resolves a city that belongs to one country', () => {
    expect(applicantCountries('Berlin')).toEqual(['DE']);
  });

  it('resolves nothing for worldwide, anywhere or an empty place: Google documents no pattern for it', () => {
    expect(applicantCountries('Worldwide')).toEqual([]);
    expect(applicantCountries('Anywhere')).toEqual([]);
    expect(applicantCountries('Remote')).toEqual([]);
    expect(applicantCountries(undefined)).toEqual([]);
  });
});
