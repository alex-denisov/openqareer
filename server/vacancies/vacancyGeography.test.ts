import { describe, expect, it } from 'vitest';
import { markGeography, regionOfVacancy } from './vacancyGeography';

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
    cluster: { id, canonicalLocation: location, isRemote, firstObservedAt: '2026-09-20T00:00:00.000Z' },
    explanation: {
      clusterId: id,
      roleMatch: 'target' as const,
      requirements: { matched: 3, total: 7 },
      outsideGeography: undefined as boolean | undefined,
    },
  });

  it('flags records outside the campaign regions and orders them last', () => {
    const marked = markGeography(
      [item('us', 'Austin, TX, United States'), item('mena', 'Riyadh, Saudi Arabia'), item('unknown', undefined)],
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
});
