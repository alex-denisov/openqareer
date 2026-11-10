import { describe, expect, it } from 'vitest';
import { isMaskedEmployer } from './employerMask';

describe('isMaskedEmployer: обезличенное название работодателя (B639)', () => {
  it.each([
    'Enterprise Energy IT Services',
    'Enterprise Public Cloud Platform (IaaS / PaaS)',
    'Corporate University of a Top-Tier Financial Institution',
    'Leading Russian Bank',
    'Top-3 Telecom Operator',
    'Confidential',
    'Крупный российский банк',
    'Международная ИТ-компания',
  ])('«%s» — маска', (name) => {
    expect(isMaskedEmployer(name)).toBe(true);
  });

  it.each([
    'OptiLab AI',
    'Fishance Berhad',
    'Kaspersky',
    'VK Cloud',
    'Россети Цифра',
    'ГК Ресурс-Логистика',
    'Сбер',
    'Торговый дом Север',
    'Сетелем Банк',
    'Итера Холдинг',
    'Невский завод',
    '',
    undefined,
  ])('«%s» — не маска', (name) => {
    expect(isMaskedEmployer(name)).toBe(false);
  });
});
