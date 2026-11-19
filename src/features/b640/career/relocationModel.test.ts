import { describe, expect, it } from 'vitest';
import { evaluateCountryFit } from '../../../../shared/countryFit';
import {
  cityRange,
  cityRight,
  placesTitle,
  placeTaxes,
  workRight,
  cityName,
} from './relocationModel';

describe('relocationModel', () => {
  it('counts countries in the title', () => {
    expect(placesTitle(1)).toBe('1 страна, куда можно уехать');
    expect(placesTitle(3)).toBe('3 страны, куда можно уехать');
    expect(placesTitle(5)).toBe('5 стран, куда можно уехать');
  });

  it('counts countries and Russian cities together when both are chosen', () => {
    expect(placesTitle(3, 2)).toBe('5 мест, куда можно уехать: 3 страны и 2 города России');
    expect(placesTitle(0, 1)).toBe('1 город России, куда можно уехать');
    expect(placesTitle(1, 5)).toBe('6 мест, куда можно уехать: 1 страна и 5 городов России');
  });

  it('names the city range in thousands and the right to work without a visa', () => {
    expect(cityRange(270_000, 370_000)).toBe('Вилка в городе: 270–370 тыс. ₽');
    expect(cityRight()).toEqual({
      tag: 'ok',
      text: 'Право работать: есть · без визы',
      mode: 'без визы',
      scenarioId: 'domestic_market',
    });
  });

  it('names the right to work and the way in from the country rules', () => {
    const unknown = workRight(evaluateCountryFit('CY', {}));
    expect(unknown).toEqual({
      tag: 'part',
      text: 'Право работать: неизвестно · виза не проверена',
      mode: null,
      scenarioId: 'employer_sponsorship',
    });
    const citizen = workRight(
      evaluateCountryFit('RS', { citizenshipCountryCodes: ['RS'], residenceDocuments: [] }),
    );
    expect(citizen.tag).toBe('ok');
    expect(citizen.text.startsWith('Право работать: есть')).toBe(true);
  });

  it('breaks the gross month into taxes, contributions and net', () => {
    const taxes = placeTaxes('RS', 600_000);
    expect(taxes?.currency).toBe('RSD');
    expect(taxes?.lines[0]).toEqual({ label: 'Доход до налогов', amount: 600_000, minus: false });
    expect(taxes?.lines.some((line) => line.label === 'Налог на доход' && line.minus)).toBe(true);
    const sum = taxes!.lines.slice(1).reduce((total, line) => total - line.amount, 600_000);
    expect(Math.abs(sum - taxes!.net)).toBeLessThan(5);
    expect(placeTaxes('ZZ', 1000)).toBeNull();
  });

  it('names the city in Russian', () => {
    expect(cityName('belgrade')).toBe('Белград');
  });
});
