import { describe, expect, it } from 'vitest';
import { extractRemoteScope } from './remoteScopeExtraction';

const scope = (location: string | undefined, description = '') =>
  extractRemoteScope({ location, description });

describe('remote scope from the location field', () => {
  it('a country in the location restricts the scope', () => {
    expect(scope('United States')).toBe('US');
    expect(scope('Remote, United States')).toBe('US');
    expect(scope('Germany, Remote')).toBe('DE');
    expect(scope('USA (Remote)')).toBe('US');
    expect(scope('Canada; United States')).toBe('CA,US');
  });

  it('a city or a state names its country', () => {
    expect(scope('Москва')).toBe('RU');
    expect(scope('Минск')).toBe('BY');
    expect(scope('Boston, MA')).toBe('US');
    expect(scope('US-CA-Menlo Park')).toBe('US');
    expect(scope('Sunnyvale, California USA')).toBe('US');
  });

  it('blocks of countries are kept as blocks', () => {
    expect(scope('Remote - EMEA')).toBe('EMEA');
    expect(scope('LATAM')).toBe('LATAM');
    expect(scope('Remote (Europe)')).toBe('EUROPE');
  });

  it('a bare remote mark is not a country', () => {
    expect(scope('Remote')).toBe('global');
    expect(scope('Удалённо')).toBe('global');
    expect(scope('Anywhere')).toBe('global');
    expect(scope(undefined)).toBe('global');
  });

  it('worldwide in the location wins over the text', () => {
    expect(scope('Worldwide', 'Must be based in the US.')).toBe('global');
  });

  it('«Global» and «Anywhere» as the whole place are worldwide (03.11 acceptance)', () => {
    expect(scope('Global', 'Must be based in the US.')).toBe('global');
    expect(scope('Remote - Global')).toBe('global');
    expect(scope('Anywhere')).toBe('global');
    expect(scope('Global Payments, Atlanta')).toBe('US');
  });

  it('acceptance places name their countries', () => {
    expect(scope('United Arab Emirates')).toBe('AE');
    expect(scope('Egypt')).toBe('EG');
    expect(scope('Qatar')).toBe('QA');
    expect(scope('Israel')).toBe('IL');
    expect(scope('AU: Melbourne: (260 Burwood Rd)')).toBe('AU');
  });
});

describe('remote scope from the description', () => {
  it('TIDI: «anywhere in the US» restricts a bare «Remote»', () => {
    expect(
      scope(
        'Remote',
        'This role can work remotely anywhere in the US, but must be willing to travel to any of our sites.',
      ),
    ).toBe('US');
  });

  it('reads the usual restricting phrasings', () => {
    expect(scope('Remote', 'You must be based in the United Kingdom.')).toBe('GB');
    expect(scope('Remote', 'Candidates must be legally authorized to work in the U.S.')).toBe('US');
    expect(scope('Remote', 'This is a remote role open to candidates located in Canada.')).toBe(
      'CA',
    );
    expect(scope('Remote', 'UAE-based remote position.')).toBe('AE');
    expect(scope('Remote', 'Remote (EMEA only).')).toBe('EMEA');
    expect(scope('Remote', 'You are based in Europe or the Americas.')).toBe('AMERICAS,EUROPE');
    expect(scope('Remote', 'We need an assistant based in Latin America.')).toBe('LATAM');
    expect(scope(undefined, 'Удалённо из любой точки России.')).toBe('RU');
    expect(scope(undefined, 'Удалённая работа, только для граждан РФ.')).toBe('RU');
  });

  it('reads the phrasings that open the role to the world', () => {
    expect(scope('Remote', 'Work from anywhere in the world.')).toBe('global');
    expect(scope('Remote', 'The team works remotely from all over the world.')).toBe('global');
    expect(scope(undefined, 'Работа из любой точки мира.')).toBe('global');
  });

  it('countries outside a scope phrase do not restrict', () => {
    expect(scope('Remote', 'We serve customers in the US and Germany. Remote-first culture.')).toBe(
      'global',
    );
    expect(scope('Remote', 'We connect you with remote jobs at US-based employers.')).toBe(
      'global',
    );
  });

  it('time-zone overlap alone is not a country restriction', () => {
    expect(scope('Remote', '4h overlap with CET time zone.')).toBe('global');
  });
});

describe('Russian inflections', () => {
  it('reads «удалённо из России» and «гражданам РФ»', () => {
    expect(extractRemoteScope({ description: 'Работаем удалённо из России.' })).toBe('RU');
    expect(extractRemoteScope({ description: 'Вакансия открыта гражданам РФ.' })).toBe('RU');
  });
});

describe('location shapes seen on prod (03.11 sample)', () => {
  it.each([
    ['Netherlands', 'NL'],
    ['San Francisco Office (Fremont St)', 'US'],
    ['NYC (SoHo)', 'US'],
    ['New York City Office', 'US'],
    ['Remote Texas', 'US'],
    ['Remote - California', 'US'],
    ['NZ: Wellington: Xero One (19-23 Taranaki St)', 'NZ'],
    ['Flexible / Remote', 'global'],
  ])('%s → %s', (location, expected) => {
    expect(extractRemoteScope({ location })).toBe(expected);
  });
});
