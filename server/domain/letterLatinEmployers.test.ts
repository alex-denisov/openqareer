import { describe, expect, it } from 'vitest';
import { latinEmployerNames, transliterate, withLatinEmployerNames } from './letterLatinEmployers';

describe('latinEmployerNames (B640): латиница названий работодателей в английском письме', () => {
  it('транслитерация, если латиницы в уточнениях нет', () => {
    expect(transliterate('Россети Цифра')).toBe('Rosseti Tsifra');
    expect(transliterate('ГК «Ресурс-Логистика»')).toBe('GK «Resurs-Logistika»');
    const names = latinEmployerNames(['Россети Цифра', 'Kaspersky'], ['Руководил дивизионами.']);
    expect([...names]).toEqual([['Россети Цифра', 'Rosseti Tsifra']]);
  });

  it('латиница из уточнений кандидата важнее транслитерации', () => {
    const names = latinEmployerNames(['Россети Цифра'], ['In English I write it as Rosseti Digital.']);
    expect(names.get('Россети Цифра')).toBe('Rosseti Digital');
  });

  it('заменяет название во всём профиле', () => {
    const names = latinEmployerNames(['Россети Цифра'], []);
    expect(withLatinEmployerNames('VP at Россети Цифра. Россети Цифра grew.', names)).toBe(
      'VP at Rosseti Tsifra. Rosseti Tsifra grew.',
    );
  });
});
