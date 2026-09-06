import { describe, expect, it } from 'vitest';
import { normalizeCityLabel } from './cityLabel';

/**
 * B203, прод 2026-09-06: карта показала «San Francisco 9» и «US - San Francisco 9»
 * двумя разными хабами, «London 28» и «UK - London 3» тоже, а строка
 * «Germany (Remote) ; Ireland (Remote) ; Netherlands (Remote) …» встала на карту
 * одним городом. Счёт по городу перестаёт быть счётом, если один город
 * посчитан дважды.
 */
describe('название города на карте', () => {
  it('снимает страновую приставку площадки', () => {
    expect(normalizeCityLabel('US - San Francisco')).toBe('San Francisco');
    expect(normalizeCityLabel('UK - London')).toBe('London');
    expect(normalizeCityLabel('SG - Singapore')).toBe('Singapore');
    expect(normalizeCityLabel('Germany - Berlin')).toBe('Berlin');
    expect(normalizeCityLabel('ES – Barcelona')).toBe('Barcelona');
  });

  it('не режет города, у которых тире внутри имени', () => {
    expect(normalizeCityLabel('Baden-Baden')).toBe('Baden-Baden');
    expect(normalizeCityLabel('Winston-Salem')).toBe('Winston-Salem');
  });

  it('оставляет город без приставки как есть', () => {
    expect(normalizeCityLabel('Berlin')).toBe('Berlin');
    expect(normalizeCityLabel('  Амстердам ')).toBe('Амстердам');
    expect(normalizeCityLabel('New York')).toBe('New York');
  });

  it('снимает пометку об удалённости, оставляя место', () => {
    expect(normalizeCityLabel('Ireland (Remote)')).toBe('Ireland');
    expect(normalizeCityLabel('Remote - Texas')).toBe('Texas');
    expect(normalizeCityLabel('Berlin (Hybrid)')).toBe('Berlin');
  });

  it('перечисление стран городом не считается', () => {
    expect(
      normalizeCityLabel(
        'Germany (Remote) ; Ireland (Remote) ; Netherlands (Remote) ; Portugal (Remote)',
      ),
    ).toBeUndefined();
    expect(normalizeCityLabel('Berlin / Munich / Hamburg')).toBeUndefined();
  });

  it('«удалённо» — не место на карте', () => {
    expect(normalizeCityLabel('Remote')).toBeUndefined();
    expect(normalizeCityLabel('Удалённо')).toBeUndefined();
    expect(normalizeCityLabel('Anywhere')).toBeUndefined();
    expect(normalizeCityLabel('  ')).toBeUndefined();
    expect(normalizeCityLabel(undefined)).toBeUndefined();
  });

  it('один город под разными записями сводится к одному ключу', () => {
    expect(normalizeCityLabel('us - san francisco')?.toLowerCase()).toBe(
      normalizeCityLabel('San Francisco')?.toLowerCase(),
    );
  });
});

describe('способ работы и надрегион местом не считаются', () => {
  it('снимает форму работы перед местом', () => {
    expect(normalizeCityLabel('Remote - Texas')).toBe('Texas');
    expect(normalizeCityLabel('Hybrid Berlin')).toBe('Berlin');
  });

  it('надрегион и способ работы городом не становятся', () => {
    expect(normalizeCityLabel('EMEA')).toBeUndefined();
    expect(normalizeCityLabel('Hybrid')).toBeUndefined();
    expect(normalizeCityLabel('Home Office')).toBeUndefined();
    expect(normalizeCityLabel('Distributed')).toBeUndefined();
    expect(normalizeCityLabel('Remote US')).toBe('US');
  });
});
