import { describe, expect, it } from 'vitest';
import { professionForms } from './professionForms';

const PRODUCT = { toBecome: 'продакт-менеджеры', genitive: 'продакта', instrumental: 'продактом' };

describe('professionForms (B669)', () => {
  it('находит формы профессии по русскому и английскому названию из словаря', () => {
    expect(professionForms('Продакт-менеджер')).toEqual(PRODUCT);
    expect(professionForms('  менеджер продукта ')).toEqual(PRODUCT);
    expect(professionForms('Product Manager')).toEqual(PRODUCT);
    expect(professionForms('Аналитик данных')).toEqual({
      toBecome: 'аналитики данных',
      genitive: 'аналитика данных',
      instrumental: 'аналитиком данных',
    });
  });

  it('профессия без форм или не из словаря — null', () => {
    expect(professionForms('Сомелье-космонавт')).toBeNull();
    expect(professionForms('')).toBeNull();
    expect(professionForms('Архитектор предприятия')).toBeNull();
  });

  it('название двух ролей с разными формами — null', () => {
    expect(professionForms('Менеджер по работе с клиентами')).toBeNull();
  });
});
