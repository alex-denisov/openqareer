import { describe, expect, it } from 'vitest';

import { parseVacancyLocation } from '../locationTree';
import { geoCountry, resolveGeoPlace, searchGeoPlaces } from './geoDirectory';
import './serverGeoDirectory';

describe('geo directory', () => {
  it('names every country in Russian, including ones the hand list never had', () => {
    expect(geoCountry('Vietnam')).toBe('Вьетнам');
    expect(geoCountry('PH')).toBe('Филиппины');
    expect(geoCountry('United States')).toBe('США');
  });

  it('finds Moscow first for «Мос» and keeps Russian cities bare', () => {
    const [first] = searchGeoPlaces('Моск');
    expect(first).toMatchObject({ kind: 'city', value: 'Москва', country: 'Россия' });
    expect(searchGeoPlaces('Берлин')[0]?.value).toBe('Берлин, Германия');
  });

  it('migrates old free-text values to directory entries', () => {
    expect(resolveGeoPlace('Moscow')?.value).toBe('Москва');
    expect(resolveGeoPlace('germany')?.value).toBe('Германия');
    expect(resolveGeoPlace('Удалённо из РФ')).toBeUndefined();
  });

  it('parses pool places the hand gazetteer dropped', () => {
    expect(parseVacancyLocation({ location: 'Paris (75)' })).toMatchObject({
      country: 'Франция',
      city: 'Париж',
    });
    expect(parseVacancyLocation({ location: 'Kuala Lumpur' })?.country).toBe('Малайзия');
    expect(parseVacancyLocation({ location: 'Тверь' })).toMatchObject({
      country: 'Россия',
      region: 'Центральный ФО',
    });
    expect(parseVacancyLocation({ location: 'Hyderabad, Telangana' })).toMatchObject({
      country: 'Индия',
      city: 'Хайдарабад',
    });
  });
});
