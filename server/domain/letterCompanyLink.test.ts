import { describe, expect, it } from 'vitest';
import { letterCompanyLink, sameCompanyGroup } from './letterCompanyLink';

describe('letterCompanyLink (B639): кандидат работал в компании вакансии или её группе', () => {
  it.each([
    ['Сбер', 'Корпоративный университет Сбера'],
    ['ПАО Сбербанк', 'Корпоративный университет Сбера'],
    ['СберТех', 'Корпоративный университет Сбера'],
    ['Sber', 'Корпоративный университет Сбера'],
    ['ООО «ВК Тех»', 'VK Cloud'],
    ['VK', 'VK Cloud'],
    ['Rosseti', 'Россети Цифра'],
    ['ПАО «Россети»', 'Россети Цифра'],
    ['Kaspersky Lab', 'Kaspersky'],
    ['Лаборатория Касперского', 'Kaspersky'],
  ])('%s ↔ %s — одна группа', (vacancy, employer) => {
    expect(sameCompanyGroup(vacancy, employer)).toBe(true);
  });

  it.each([
    ['Ростелеком', 'Россети Цифра'],
    ['Платформа Третье Мнение', 'VK Cloud'],
    ['CoinsPaid', 'Fishance Berhad'],
    ['Ада Кондэ', 'OptiLab AI'],
    ['LIYAN McATEER, LLC', 'Kaspersky'],
    ['Корпоративный университет РЖД', 'Корпоративный университет Сбера'],
    ['Российский банк развития', 'Крупный российский банк'],
    ['IT Services Group', 'Enterprise Energy IT Services'],
    ['', 'Сбер'],
  ])('%s ↔ %s — разные компании', (vacancy, employer) => {
    expect(sameCompanyGroup(vacancy, employer)).toBe(false);
  });

  it('возвращает название места кандидата, совпавшее с компанией вакансии', () => {
    expect(
      letterCompanyLink('Сбер', ['OptiLab AI', 'Россети Цифра', 'Корпоративный университет Сбера']),
    ).toBe('Корпоративный университет Сбера');
    expect(letterCompanyLink('CoinsPaid', ['OptiLab AI', 'Россети Цифра'])).toBeUndefined();
    expect(letterCompanyLink(undefined, ['Сбер'])).toBeUndefined();
  });
});
