import { describe, expect, it } from 'vitest';
import { contactMessageLanguage } from './contactMessageLanguage';

describe('B753: язык черновика — по контакту и вакансии (решение CPO 23.11)', () => {
  it('Capital One: текст вакансии по-английски — английский', () => {
    expect(contactMessageLanguage('Ayesha Azhar', {
      title: 'Senior Lead AI Engineer', summary: 'We are looking for a lead engineer to build agentic AI platform services.', location: 'McLean, VA, United States',
    })).toBe('en');
  });

  it('Сбер: русская вакансия и русское имя — русский', () => {
    expect(contactMessageLanguage('Ольга Петрова', {
      title: 'Директор по кредитным продуктам (CPO)', summary: 'Ищем руководителя кредитных продуктов для розничного бизнеса.', location: 'Москва',
    })).toBe('ru');
  });

  it('латинское имя и русская вакансия в Москве — русский', () => {
    expect(contactMessageLanguage('Alexandr Alexandrov', {
      title: 'Руководитель отдела AI-трансформации аналитики', summary: 'Команда VK ищет руководителя.', location: 'Москва',
    })).toBe('ru');
  });

  it('латинское имя и вакансия вне России и СНГ — английский', () => {
    expect(contactMessageLanguage('Anna Schmidt', {
      title: 'Руководитель направления данных', summary: 'Команда в Берлине.', location: 'Berlin, Germany',
    })).toBe('en');
  });

  it('без вакансии — русский', () => {
    expect(contactMessageLanguage('Pavel Khudyakov', null)).toBe('ru');
  });
});
