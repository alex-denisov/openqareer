import { describe, expect, it } from 'vitest';
import {
  isValidPublicPath,
  publicPathViolation,
  isTransliteratedSegment,
} from './seoSlugPolicy';

describe('политика публичных адресов (B209)', () => {
  it('принимает естественный английский путь', () => {
    expect(isValidPublicPath('/vacancies/remote/frontend-developer')).toBe(true);
    expect(isValidPublicPath('/vacancies/remote/senior-product-manager')).toBe(true);
    expect(isValidPublicPath('/legal/privacy')).toBe(true);
    expect(isValidPublicPath('/')).toBe(true);
  });

  it('отклоняет транслит русских слов и называет причину', () => {
    expect(isValidPublicPath('/vakansii/moskva')).toBe(false);
    expect(isValidPublicPath('/rabota/razrabotchik-interfeisov')).toBe(false);
    expect(publicPathViolation('/vakansii/moskva')).toContain('vakansii');
  });

  it('пропускает российские программные продукты без английского эквивалента', () => {
    expect(isValidPublicPath('/vacancies/moscow/programmist-1c')).toBe(true);
    expect(isValidPublicPath('/vacancies/moscow/1c-analitik')).toBe(true);
    // Исключение действует только на сегмент с 1С, соседний транслит остаётся ошибкой.
    expect(isValidPublicPath('/vakansii/moscow/programmist-1c')).toBe(false);
  });

  it('отклоняет кириллицу, верхний регистр, подчёркивания и пустые сегменты', () => {
    expect(isValidPublicPath('/вакансии/москва')).toBe(false);
    expect(isValidPublicPath('/vacancies/Remote')).toBe(false);
    expect(isValidPublicPath('/vacancies/frontend_developer')).toBe(false);
    expect(isValidPublicPath('/vacancies//remote')).toBe(false);
    expect(isValidPublicPath('vacancies/remote')).toBe(false);
  });

  it('ловит транслит по диграфам, которых нет в английском', () => {
    expect(isTransliteratedSegment('zhurnal')).toBe(true);
    expect(isTransliteratedSegment('borshch')).toBe(true);
    expect(isTransliteratedSegment('developer')).toBe(false);
  });

  it('не даёт ложного срабатывания на английских словах с русскими корнями внутри', () => {
    expect(isTransliteratedSegment('data-analyst')).toBe(false);
    expect(isTransliteratedSegment('product-manager')).toBe(false);
    expect(isTransliteratedSegment('remote')).toBe(false);
  });

  it('возвращает null как причину для валидного пути', () => {
    expect(publicPathViolation('/legal/terms')).toBeNull();
  });
});
