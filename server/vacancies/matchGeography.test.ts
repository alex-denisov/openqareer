import { describe, expect, it } from 'vitest';
import { careerGeographyOf } from './careerGeography';
import { matchGeographyKey, matchGeographyOf } from './matchGeography';

describe('география подбора для SQL (аудит 01.11)', () => {
  it('«Москва» и «Удалённо из РФ» дают написания города и удалёнку', () => {
    const geography = matchGeographyOf(
      careerGeographyOf({ searchLocations: ['Москва', 'Удалённо из РФ'] }),
    );

    expect(geography?.remote).toBe(true);
    expect(geography?.cityNames).toEqual(expect.arrayContaining(['Москва', 'moscow']));
  });

  it('страна вместо города не сужает SQL: строка вакансии хранит город', () => {
    expect(matchGeographyOf(careerGeographyOf({ searchLocations: ['Россия'] }))).toBeUndefined();
  });

  it('без мест фильтра нет, и ключ снимка прежний', () => {
    expect(matchGeographyOf(careerGeographyOf({ searchLocations: [] }))).toBeUndefined();
    expect(matchGeographyKey(undefined)).toBe('');
  });

  it('страна рядом с городом не снимает фильтр: города прежних мест сохраняются', () => {
    const before = matchGeographyOf(
      careerGeographyOf({ searchLocations: ['Москва', 'Удалённо из РФ'] }),
    );
    const after = matchGeographyOf(
      careerGeographyOf({ searchLocations: ['Москва', 'Удалённо из РФ', 'ОАЭ'] }),
    );

    expect(after).toBeDefined();
    expect(after?.remote).toBe(true);
    expect(after?.cityNames).toEqual(expect.arrayContaining([...(before?.cityNames ?? ['x'])]));
    expect(after?.cityNames).toEqual(expect.arrayContaining(['Дубай']));
  });
});
