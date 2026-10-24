import { describe, expect, it } from 'vitest';
import { salaryGeography } from './salaryMarketGeography';
import { countryCodeFromNameOrCode } from '../domain/geoCoordinates';
import { regionOfVacancy } from '../vacancies/vacancyGeography';

describe('conservative public salary geography evidence', () => {
  it.each([
    ['Berlin, Germany', 'DE', 'europe'],
    ['Remote (France)', 'FR', 'europe'],
    ['AE', 'AE', 'uae'],
    ['Dubai, United Arab Emirates', 'AE', 'uae'],
    ['Алматы, Казахстан', 'KZ', 'cis'],
    ['London, United Kingdom', 'GB', 'europe'],
    ['Germany, DE', 'DE', 'europe'],
    ['LT', 'LT', 'europe'],
    ['TJ', 'TJ', 'cis'],
  ])('uses an explicit country in %s', (value, countryCode, location) => {
    expect(salaryGeography(value, false)).toEqual({
      status: 'explicit_country',
      countryCode,
      locations: [location],
    });
  });
  it.each([
    'Berlin',
    'Dubai',
    'Remote',
    'Worldwide',
    'Europe',
    'CIS',
    '',
    'USD',
    'Russian-speaking',
  ])('does not invent a country for %s', (value) => {
    expect(salaryGeography(value, false)).toMatchObject({
      status: 'unknown_country',
      locations: [],
    });
  });
  it.each([
    'Chicago, IL',
    'Atlanta, Georgia',
    'CA',
    'DE',
    'Germany / United States',
    'France; UAE',
  ])('keeps ambiguous source %s outside country slices', (value) => {
    expect(salaryGeography(value, false)).toMatchObject({
      status: 'ambiguous_country',
      locations: [],
    });
  });
  it('uses remote independently and retains the approved Russia/CIS and MENA/UAE distinction', () => {
    expect(salaryGeography(null, true)).toEqual({
      status: 'unknown_country',
      locations: ['remote'],
    });
    expect(salaryGeography('Germany', true).locations).toEqual(['remote', 'europe']);
    expect(salaryGeography('Россия', false)).toMatchObject({ countryCode: 'RU', locations: [] });
    expect(salaryGeography('Saudi Arabia', false)).toMatchObject({
      countryCode: 'SA',
      locations: [],
    });
    expect(salaryGeography('Chicago, IL, United States', false)).toMatchObject({
      countryCode: 'US',
      locations: [],
    });
  });
  it('bounds hostile or oversized labels without dropping stored remote evidence', () => {
    expect(salaryGeography('Germany'.repeat(1000), true)).toEqual({
      status: 'unknown_country',
      locations: ['remote'],
    });
    expect(salaryGeography(Array(40).fill('Germany').join(','), false).status).toBe(
      'unknown_country',
    );
  });
});

describe('country-only lookup does not alter existing geography behavior', () => {
  it('never falls back to cities and keeps ambiguous raw postal codes unknown', () => {
    expect(countryCodeFromNameOrCode('Berlin')).toBeUndefined();
    expect(countryCodeFromNameOrCode('Dubai')).toBeUndefined();
    expect(countryCodeFromNameOrCode('DE')).toBe('DE');
    expect(regionOfVacancy({ country: 'DE' })).toBeUndefined();
    expect(salaryGeography('DE', false).status).toBe('ambiguous_country');
  });
});
