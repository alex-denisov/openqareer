import { describe, expect, it } from 'vitest';
import { careerGeographyOf, withinCareerGeography } from './careerGeography';
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

describe('«Москва и область» и Зеленоград (владелец 04.11)', () => {
  const inPlaces = (entry: string, location: string) => {
    const geography = careerGeographyOf({ searchLocations: [entry] });
    return withinCareerGeography({ cluster: { canonicalLocation: location } }, geography!);
  };

  it.each(['Химки', 'Подольск', 'Мытищи', 'Домодедово', 'Зеленоград', 'Москва', 'Королев', 'Московская область', 'Талдом (Московская область)'])(
    '«Москва и область» берёт %s',
    (location) => {
      expect(inPlaces('Москва и область', location)).toBe(true);
    },
  );

  it.each(['Санкт-Петербург', 'Тверь', 'Подольск, Украина'])('«Москва и область» не берёт %s', (location) => {
    expect(inPlaces('Москва и область', location)).toBe(false);
  });

  it('«Москва» без склейки: Зеленоград да, Химки и Подольск нет', () => {
    expect(inPlaces('Москва', 'Зеленоград')).toBe(true);
    expect(inPlaces('Москва', 'Химки')).toBe(false);
    expect(inPlaces('Москва', 'Подольск')).toBe(false);
  });

  it('фильтр SQL получает написания области одной строкой, а не страну', () => {
    const area = matchGeographyOf(careerGeographyOf({ searchLocations: ['Москва и область', 'ОАЭ'] }));
    expect(area?.cityNames).toEqual(expect.arrayContaining(['Химки', 'khimki', 'Москва', 'moscow']));
    const city = matchGeographyOf(careerGeographyOf({ searchLocations: ['Москва'] }));
    expect(city?.cityNames).toEqual(expect.arrayContaining(['Зеленоград', 'zelenograd']));
    expect(city?.cityNames).not.toContain('Химки');
  });

  it('выбор идёт в регион ru', () => {
    expect(careerGeographyOf({ searchLocations: ['Москва и область'] })?.regions).toEqual(['ru']);
  });
});
