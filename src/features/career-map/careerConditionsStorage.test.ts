import { describe, expect, it } from 'vitest';
import {
  decisionProfileToSearchConditions,
  formatCompaniesCount,
  formatConditionsFormat,
  formatGeography,
  formatGeographyShort,
  searchConditionsToDecisionProfile,
} from './careerConditionsStorage';

describe('условия поиска из профиля ограничений (B445)', () => {
  it('без данных кандидата ничего не подставляет', () => {
    const conditions = decisionProfileToSearchConditions(null);
    expect(conditions.geography.selected).toEqual([]);
    expect(conditions.salaryFrom.amountRubles).toBeNull();
    expect(formatConditionsFormat(conditions.format)).toBeNull();
  });

  it('гражданство не становится географией поиска', () => {
    const conditions = decisionProfileToSearchConditions({
      citizenship: ['RU'],
      workFormats: [],
      languages: [],
    });
    expect(conditions.geography.selected).toEqual([]);
  });

  it('берёт города, пол зарплаты и формат из профиля', () => {
    const conditions = decisionProfileToSearchConditions({
      citizenship: ['RU'],
      languages: [],
      searchLocations: ['Москва'],
      salaryFloor: 500_000,
      workFormats: ['home_market', 'remote_home'],
    });
    expect(conditions.geography.selected).toEqual(['Москва']);
    expect(conditions.salaryFrom.amountRubles).toBe(500_000);
    expect(formatConditionsFormat(conditions.format)).toBe('Гибрид, удалённо');
  });

  it('сохраняет географию отдельно и не трогает гражданство', () => {
    const conditions = decisionProfileToSearchConditions(null);
    const profile = searchConditionsToDecisionProfile(
      { ...conditions, geography: { selected: ['Казань'], isRelocationEnabled: false } },
      { citizenship: ['RU'], languages: [], workFormats: [] },
    );
    expect(profile.citizenship).toEqual(['RU']);
    expect(profile.searchLocations).toEqual(['Казань']);
    expect(profile).not.toHaveProperty('salaryFloor');
  });

  it('склоняет число компаний', () => {
    expect(formatCompaniesCount(1)).toBe('1 компания');
    expect(formatCompaniesCount(2)).toBe('2 компании');
    expect(formatCompaniesCount(12)).toBe('12 компаний');
  });
});

describe('география в строке условий (макет 3)', () => {
  it('«удалённо» со строчной внутри списка и с прописной в начале', () => {
    expect(formatGeography(['Москва', 'Удалённо из РФ', 'ОАЭ'])).toBe(
      'Москва, удалённо из РФ, ОАЭ',
    );
    expect(formatGeography(['Удалённо из РФ', 'Москва'])).toBe('Удалённо из РФ, Москва');
    expect(formatGeography([])).toBeNull();
  });

  it('390: коротко, без слова «удалённо» и без повторов', () => {
    expect(formatGeographyShort(['Москва', 'Удалённо из РФ'])).toBe('Москва, РФ');
    expect(formatGeographyShort(['Москва', 'Удалённо из РФ', 'ОАЭ'])).toBe('Москва, РФ, ОАЭ');
    expect(formatGeographyShort(['Россия › Центральный ФО › Москва'])).toBe('Москва');
    expect(formatGeographyShort(['Удалённо'])).toBe('Удалённо');
    expect(formatGeographyShort(['РФ', 'Удалённо из РФ'])).toBe('РФ');
    expect(formatGeographyShort([])).toBeNull();
  });
});
