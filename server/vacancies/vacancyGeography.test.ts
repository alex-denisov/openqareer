import { describe, expect, it } from 'vitest';
import {
  dropForeignRemote,
  markGeography,
  regionOfVacancy,
  remoteCountryFit,
} from './vacancyGeography';

/**
 * PRB-040. Кампания «Xray Technician, MENA» получала первыми «Field Services
 * Technician, United States» и «Design Production Specialist, Nicaragua».
 * География вакансии читается из её локации и страны; запись вне выбранных
 * рынков помечается и уходит в конец, но не исчезает — источник мог назвать
 * страну неточно, а решать за кандидата продукт не вправе.
 */
describe('regionOfVacancy', () => {
  it('reads the region from a country at the end of the location', () => {
    expect(regionOfVacancy({ location: 'Düsseldorf, North Rhine-Westphalia, Germany' })).toBe('eu');
    expect(regionOfVacancy({ location: 'United States' })).toBe('us');
    expect(regionOfVacancy({ location: 'Nicaragua' })).toBe('latam');
    expect(regionOfVacancy({ location: 'Dubai, United Arab Emirates' })).toBe('mena');
    expect(regionOfVacancy({ location: 'Москва' })).toBe('ru');
    expect(regionOfVacancy({ location: 'Алматы, Казахстан' })).toBe('cis');
    expect(regionOfVacancy({ location: 'Singapore' })).toBe('apac');
  });

  it('prefers the structured country over the free-text location', () => {
    expect(regionOfVacancy({ location: 'Remote', country: 'Egypt' })).toBe('mena');
    expect(regionOfVacancy({ location: 'Remote', country: 'US' })).toBe('us');
  });

  it('answers undefined when the place is unknown or missing', () => {
    expect(regionOfVacancy({ location: 'Worldwide' })).toBeUndefined();
    expect(regionOfVacancy({ location: '' })).toBeUndefined();
    expect(regionOfVacancy({})).toBeUndefined();
  });
});

describe('markGeography', () => {
  const item = (id: string, location: string | undefined, isRemote = false) => ({
    cluster: {
      id,
      canonicalLocation: location,
      isRemote,
      firstObservedAt: '2026-09-20T00:00:00.000Z',
    },
    explanation: {
      clusterId: id,
      roleMatch: 'target' as const,
      requirements: { matched: 3, total: 7 },
      outsideGeography: undefined as boolean | undefined,
    },
  });

  it('flags records outside the campaign regions and orders them last', () => {
    const marked = markGeography(
      [
        item('us', 'Austin, TX, United States'),
        item('mena', 'Riyadh, Saudi Arabia'),
        item('unknown', undefined),
      ],
      ['mena'],
    );
    expect(marked.map((entry) => entry.cluster.id)).toEqual(['mena', 'unknown', 'us']);
    expect(marked.map((entry) => entry.explanation.outsideGeography ?? false)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('never flags remote work or a candidate without regions', () => {
    const remote = markGeography([item('r', 'United States', true)], ['ru']);
    expect(remote[0].explanation.outsideGeography).toBeUndefined();
    const anywhere = markGeography([item('u', 'United States')], []);
    expect(anywhere[0].explanation.outsideGeography).toBeUndefined();
  });

  it('uses geography after role relevance and ranks remote ahead of a distant office at the same relevance', () => {
    const partial = (id: string, location: string | undefined, isRemote = false) => ({
      ...item(id, location, isRemote),
      explanation: { ...item(id, location, isRemote).explanation, roleMatch: 'partial' as const },
    });
    const marked = markGeography(
      [
        item('distant-target', 'Austin, TX, United States'),
        partial('distant-partial', 'Austin, TX, United States'),
        partial('remote-partial', 'Remote', true),
        partial('local-partial', 'Dubai, United Arab Emirates'),
      ],
      ['mena'],
    );

    expect(marked.map((entry) => entry.cluster.id)).toEqual([
      'distant-target',
      'remote-partial',
      'local-partial',
      'distant-partial',
    ]);
  });
});

describe('штаты и провинции после города (B546)', () => {
  it('«City, ST» — Северная Америка, а не ISO-страна', () => {
    expect(regionOfVacancy({ location: 'Chicago, IL' })).toBe('us');
    expect(regionOfVacancy({ location: 'Indianapolis, IN 46209' })).toBe('us');
    expect(regionOfVacancy({ location: 'Honolulu, HI 96813', country: 'HI 96813' })).toBe('us');
    expect(regionOfVacancy({ location: 'Mississauga, ON L4W 5J1' })).toBe('us');
    expect(regionOfVacancy({ location: 'Atlanta, GA; Dallas, TX' })).toBe('us');
    expect(regionOfVacancy({ location: 'Tel Aviv, Israel' })).toBe('mena');
  });
});

/** CPO 26.10: «Remote» без страны или в другой стране не равно «совпадает» для «Удалённо из РФ». */
describe('remoteCountry', () => {
  const remote = (id: string, location: string | undefined) => ({
    cluster: {
      id,
      canonicalLocation: location,
      isRemote: true,
      firstObservedAt: '2026-09-20T00:00:00.000Z',
    },
    explanation: {
      clusterId: id,
      roleMatch: 'target' as const,
      requirements: { matched: 3, total: 7 },
    },
  });

  it('marks remote without a country and remote in another country', () => {
    const marked = markGeography(
      [
        remote('none', 'Remote'),
        remote('us', 'Remote, United States'),
        remote('ru', 'Удалённо, Россия'),
      ],
      ['ru'],
    );
    const byId = new Map(marked.map((item) => [item.cluster.id, item.explanation]));
    expect(byId.get('none')).toMatchObject({ remoteCountry: 'unknown' });
    expect(byId.get('us')).toMatchObject({ remoteCountry: 'other' });
    expect(byId.get('ru')).not.toHaveProperty('remoteCountry');
    expect(byId.get('us')).not.toHaveProperty('outsideGeography');
  });
});

describe('dropForeignRemote (27.10)', () => {
  const item = (remoteCountry?: 'unknown' | 'other') =>
    ({ explanation: remoteCountry ? { remoteCountry } : {} }) as never;

  it('убирает удалёнку из другой страны и оставляет неизвестную с пометкой', () => {
    const kept = dropForeignRemote([item('other'), item('unknown'), item()]);
    expect(kept).toHaveLength(2);
  });
});

describe('словарь стран вне семи рынков (27.10)', () => {
  it('узнаёт страны Карибов, Африки и Южной Азии', () => {
    expect(regionOfVacancy({ location: 'Jamaica' })).toBe('latam');
    expect(regionOfVacancy({ location: 'Nassau, Bahamas' })).toBe('latam');
    expect(regionOfVacancy({ location: 'Suriname' })).toBe('latam');
    expect(regionOfVacancy({ location: 'Sri Lanka' })).toBe('apac');
    expect(regionOfVacancy({ location: 'Luxembourg, Luxembourg' })).toBe('eu');
  });

  it('удалёнка из такой страны для кандидата «Удалённо из РФ» — другая страна', () => {
    expect(remoteCountryFit({ canonicalLocation: 'Nigeria', isRemote: true }, ['ru'])).toBe('other');
    expect(remoteCountryFit({ canonicalLocation: 'Jamaica', isRemote: true }, ['ru'])).toBe('other');
    expect(remoteCountryFit({ canonicalLocation: 'Remote', isRemote: true }, ['ru'])).toBe('unknown');
  });
});

describe('страна в конце части и через тире (28.10)', () => {
  it('узнаёт «California USA» и «Remote - US»', () => {
    expect(regionOfVacancy({ location: 'Sunnyvale, California USA' })).toBe('us');
    expect(regionOfVacancy({ location: 'Remote - US' })).toBe('us');
    expect(regionOfVacancy({ location: 'Remote - Germany' })).toBe('eu');
  });
});

it('строчное «in» в конце — не ISO-код Индии', () => {
  expect(regionOfVacancy({ location: 'Work from home in' })).toBeUndefined();
});

describe('города пула прода без страны (28.10)', () => {
  it('города США и полное название страны', () => {
    expect(regionOfVacancy({ location: 'Palo Alto' })).toBe('us');
    expect(regionOfVacancy({ location: 'Cupertino' })).toBe('us');
    expect(regionOfVacancy({ location: 'San Diego, California, United States of America' })).toBe('us');
  });

  it('города СНГ с hh.ru', () => {
    expect(regionOfVacancy({ location: 'Бишкек' })).toBe('cis');
    expect(regionOfVacancy({ location: 'Караганда' })).toBe('cis');
    expect(regionOfVacancy({ location: 'Гомель' })).toBe('cis');
  });

  it('прочий кириллический город с hh.ru — Россия; «удалённо» и спорные города — без страны', () => {
    expect(regionOfVacancy({ location: 'Красноярск' })).toBe('ru');
    expect(regionOfVacancy({ location: 'Подольск (Московская область)' })).toBe('ru');
    expect(regionOfVacancy({ location: 'Удалённо' })).toBeUndefined();
    expect(regionOfVacancy({ location: 'Донецк' })).toBeUndefined();
    expect(regionOfVacancy({ location: 'Remote' })).toBeUndefined();
    expect(regionOfVacancy({ location: '2 Locations' })).toBeUndefined();
  });
});

describe('код страны в начале места (28.10)', () => {
  it('Workday «US-CA-Menlo Park», «AU-Sydney» и «United States (Remote)»', () => {
    expect(regionOfVacancy({ location: 'US-CA-Menlo Park' })).toBe('us');
    expect(regionOfVacancy({ location: 'AU-Sydney' })).toBe('apac');
    expect(regionOfVacancy({ location: 'United States (Remote)' })).toBe('us');
    expect(regionOfVacancy({ location: 'Remote, Global' })).toBeUndefined();
  });
});
