import { describe, expect, it } from 'vitest';
import { latinCityName } from './placeNames';

/**
 * Публичные адреса — только естественный английский (решение владельца, B209).
 * Городу нужно его английское имя, а не транслит: «Москва» → `moscow`, а не
 * `moskva`. Имя собственное переводится по списку — угадать его нельзя.
 */
describe('английское имя города для адреса (B209)', () => {
  it('переводит русский город по списку', () => {
    expect(latinCityName('Москва')).toBe('moscow');
    expect(latinCityName('Санкт-Петербург')).toBe('saint-petersburg');
    expect(latinCityName('Нижний Новгород')).toBe('nizhny-novgorod');
    expect(latinCityName('Тбилиси')).toBe('tbilisi');
  });

  it('оставляет английское имя, приводя его к виду адреса', () => {
    expect(latinCityName('Berlin')).toBe('berlin');
    expect(latinCityName('San Francisco')).toBe('san-francisco');
    expect(latinCityName('Frankfurt am Main')).toBe('frankfurt-am-main');
  });

  it('молчит о городе, которого в списке нет, вместо транслита', () => {
    expect(latinCityName('Урюпинск')).toBeUndefined();
    expect(latinCityName('Мытищи')).toBeUndefined();
    expect(latinCityName('')).toBeUndefined();
    expect(latinCityName(undefined)).toBeUndefined();
  });

  it('не даёт городу занять служебный сегмент адреса', () => {
    expect(latinCityName('Job')).toBeUndefined();
    expect(latinCityName('Page')).toBeUndefined();
    expect(latinCityName('Remote')).toBeUndefined();
  });

  it('не выдаёт страну за город', () => {
    expect(latinCityName('Германия')).toBeUndefined();
    expect(latinCityName('Portugal')).toBeUndefined();
  });

  /**
   * Найдено на живом пуле 2026-09-07: публичные адреса
   * `/vacancies/anywhere-in-france`, `/vacancies/global-remote`,
   * `/vacancies/in-office`, `/vacancies/remote-texas` — это не города, а
   * способ работы или надрегион, просочившийся в поле места.
   */
  it('не принимает за город способ работы и надрегион', () => {
    expect(latinCityName('Anywhere in France')).toBeUndefined();
    expect(latinCityName('Anywhere in Belgium')).toBeUndefined();
    expect(latinCityName('Global Remote')).toBeUndefined();
    expect(latinCityName('In-Office')).toBeUndefined();
    expect(latinCityName('Remote Texas')).toBeUndefined();
    expect(latinCityName('Remote - US: Select locations')).toBeUndefined();
    expect(latinCityName('Nationwide')).toBeUndefined();
  });

  it('сводит известные написания одного города к одному адресу', () => {
    expect(latinCityName('New York City')).toBe('new-york');
    expect(latinCityName('New York')).toBe('new-york');
  });

  it('не отбрасывает город, в имени которого такое слово настоящее', () => {
    expect(latinCityName('Regina')).toBe('regina');
    expect(latinCityName('Offenbach')).toBe('offenbach');
  });

  /**
   * Живой пул 2026-09-07 дал адреса `/vacancies/the-river-building` и
   * `/vacancies/victoria-st`: в поле места приехали название здания и улица.
   */
  it('не принимает за город улицу и здание', () => {
    expect(latinCityName('The River Building')).toBeUndefined();
    expect(latinCityName('Victoria St')).toBeUndefined();
    expect(latinCityName('Baker Street')).toBeUndefined();
    expect(latinCityName('Park Avenue')).toBeUndefined();
  });

  /** «St» в начале — часть имени города, а не улица. */
  it('не отбрасывает город, имя которого начинается со «St»', () => {
    expect(latinCityName('St Petersburg')).toBe('st-petersburg');
    expect(latinCityName('St Albans')).toBe('st-albans');
  });
});
