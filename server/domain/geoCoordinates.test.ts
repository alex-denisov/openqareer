import { describe, expect, it } from 'vitest';
import { lookupLocationCoordinates } from './geoCoordinates';

const FIXTURE_CITY_ALIASES: readonly {
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
  readonly country?: string;
}[] = [
  { name: 'Москва', lat: 55.75, lng: 37.62 },
  { name: 'Moscow', lat: 55.75, lng: 37.62 },
  { name: 'г. Москва', lat: 55.75, lng: 37.62 },
  { name: 'Москва, м. Курская', lat: 55.75, lng: 37.62 },
  { name: 'Санкт-Петербург', lat: 59.93, lng: 30.31 },
  { name: 'СПб', lat: 59.93, lng: 30.31 },
  { name: 'Алматы', lat: 43.25249, lng: 76.9115 },
  { name: 'Almaty', lat: 43.25249, lng: 76.9115 },
  { name: 'Дубай', lat: 25.07725, lng: 55.30927 },
  { name: 'Dubai', lat: 25.07725, lng: 55.30927 },
  { name: 'Амстердам', lat: 52.37, lng: 4.90 },
  { name: 'Amsterdam', lat: 52.37, lng: 4.90 },
  { name: 'Велдховен', lat: 51.4178, lng: 5.4054 },
  { name: 'Veldhoven', lat: 51.4178, lng: 5.4054 },
  { name: 'Berlin', lat: 52.52, lng: 13.41 },
  { name: 'London', country: 'United Kingdom', lat: 51.51, lng: -0.13 },
  { name: 'Yerevan', lat: 40.18, lng: 44.51 },
  { name: 'San Francisco', lat: 37.77, lng: -122.42 },
  { name: 'Lisbon', lat: 38.72, lng: -9.14 },
  { name: 'Porto', country: 'Portugal', lat: 41.15, lng: -8.61 },
];

describe('локальный справочник координат городов', () => {
  it.each(FIXTURE_CITY_ALIASES)('$name распознаётся по данным вакансий', ({ name, country, lat, lng }) => {
    const point = lookupLocationCoordinates(name, country);
    expect(point).toBeDefined();
    expect(point?.lat).toBeCloseTo(lat, 1);
    expect(point?.lng).toBeCloseTo(lng, 1);
  });

  it('оставляет неоднозначное имя без точки, пока страна не разрешит совпадение', () => {
    expect(lookupLocationCoordinates('San Jose')).toBeUndefined();
    expect(lookupLocationCoordinates('San Jose', 'United States')?.lat).toBeCloseTo(37.34, 1);
    expect(lookupLocationCoordinates('San Jose', 'Canada')).toBeUndefined();
  });

  it('не переносит неизвестный город в центр известной страны', () => {
    expect(lookupLocationCoordinates('Unknown Vacancy City', 'United States')).toBeUndefined();
    expect(lookupLocationCoordinates(undefined, 'Германия')).toBeDefined();
  });

  it('не применяет координаты малого города к чужой стране', () => {
    expect(lookupLocationCoordinates('Veldhoven', 'Netherlands')).toEqual({
      lat: 51.4178,
      lng: 5.4054,
    });
    expect(lookupLocationCoordinates('Veldhoven', 'Germany')).toBeUndefined();
  });
});
