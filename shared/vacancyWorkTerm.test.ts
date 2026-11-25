import { describe, expect, it } from 'vitest';
import { isWorkTerm } from './vacancyWorkTerm';

const other = (text: string) => isWorkTerm({ text, kind: 'other', skill: false });

describe('B794: employer terms are no requirements', () => {
  it.each([
    'Комфортный офис БЦ Верейская Плаза',
    'График работы 5/2, 09:00 - 18:00',
    'Оформление по ТК РФ',
    'Работа в стабильной компании',
    'Полная занятость',
    'Место работы: м. Бутырская',
    'Permanent, Full-Time',
    'ДМС через 1 год работы в компании',
    'Прямое подчинение Генеральному директору',
  ])('hides «%s»', (text) => expect(other(text)).toBe(true));

  it.each([
    'Высшее (специалитет/магистратура) по направлению деятельности',
    'Готовность к командировкам',
    'Сертификат 1С:Специалист/1С:Эксперт.',
    'An active U.S. security clearance, or eligibility to obtain one',
    'релокация в Краснодар - обязательна',
    'Must be willing to travel to customer sites as needed',
  ])('keeps «%s»', (text) => expect(other(text)).toBe(false));

  it('hides a work format and keeps education and skills', () => {
    expect(isWorkTerm({ text: 'Work Location: Remote', kind: 'workFormat', skill: false })).toBe(
      true,
    );
    expect(isWorkTerm({ text: 'Высшее образование', kind: 'education', skill: false })).toBe(false);
    expect(isWorkTerm({ text: 'График 5/2', kind: 'other', skill: true })).toBe(false);
  });
});
