import { describe, expect, it } from 'vitest';
import { parseHhSearchState, HH_STATE_UNREADABLE } from './hhSearchState';

/**
 * Образцы взяты с живой страницы `hh.ru/search/vacancy?text=qa&area=113`
 * 2026-09-13 и урезаны до полей, которые читает разбор (B214). Форма полей —
 * настоящая, включая те варианты зарплаты, которые площадка отдаёт реально:
 * «вилка», «только от», «только до», «не указана».
 */
function pageWith(state: unknown): string {
  const json = JSON.stringify(state)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  return `<!DOCTYPE html><html><body><template id="HH-Lux-InitialState">${json}</template></body></html>`;
}

/**
 * Так страница экранирует на самом деле: числовыми ссылками, а не именованными.
 * Разбор на именованных сущностях проходил все образцы и падал на живой
 * странице — тест закрывает именно это (B214, живой прогон 2026-09-13).
 */
function pageWithNumericEntities(state: unknown): string {
  const json = JSON.stringify(state)
    .replaceAll('&', '&#38;')
    .replaceAll('<', '&#60;')
    .replaceAll('>', '&#62;')
    .replaceAll('"', '&#34;');
  return `<!--noindex--><template style="display:none" id="HH-Lux-InitialState">${json}</template>`;
}

const vacancy = {
  vacancyId: 133712099,
  name: 'Автотестировщик в крауд-тестирование',
  area: { '@id': 88, name: 'Казань', path: '.113.227.1624.88.' },
  company: { id: 9498112, name: 'Яндекс Крауд' },
  compensation: { currencyCode: 'RUR', from: 80000, to: 100000, gross: false },
  creationTime: '2026-06-01T12:16:59.803+03:00',
  publicationTime: { '@timestamp': 1788862062, $: '2026-09-08T13:07:42.322+03:00' },
  links: { desktop: 'https://hh.ru/vacancy/133712099', mobile: 'https://m.hh.ru/vacancy/133712099' },
  workExperience: 'between1And3',
  employmentForm: 'FULL',
  workFormats: [{ workFormatsElement: ['REMOTE'] }],
};

const context = { observedAt: '2026-09-13T15:00:00.000Z', sourceName: 'hh.ru' };

describe('parseHhSearchState', () => {
  it('читает вакансию со страницы поиска', () => {
    const result = parseHhSearchState(
      pageWith({ vacancySearchResult: { totalResults: 1319, vacancies: [vacancy] } }),
      context,
    );

    expect(result.totalResults).toBe(1319);
    expect(result.vacancies).toHaveLength(1);
    const parsed = result.vacancies[0];
    expect(parsed.title).toBe('Автотестировщик в крауд-тестирование');
    expect(parsed.company).toBe('Яндекс Крауд');
    expect(parsed.location).toBe('Казань');
    expect(parsed.url).toBe('https://hh.ru/vacancy/133712099');
    expect(parsed.isRemote).toBe(true);
    expect(parsed.salary).toEqual({ from: 80000, to: 100000, currency: 'RUR', gross: false });
    expect(parsed.publishedAt).toBe('2026-09-08T13:07:42.322+03:00');
    expect(parsed.provenance.sourceId).toBe('src-hh-search');
    expect(parsed.provenance.externalId).toBe('133712099');
  });

  it('«не указана» — это отсутствие зарплаты, а не ноль', () => {
    const result = parseHhSearchState(
      pageWith({
        vacancySearchResult: {
          totalResults: 1,
          vacancies: [{ ...vacancy, compensation: { noCompensation: {} } }],
        },
      }),
      context,
    );

    expect(result.vacancies[0].salary).toBeUndefined();
  });

  it('односторонняя вилка остаётся односторонней', () => {
    const result = parseHhSearchState(
      pageWith({
        vacancySearchResult: {
          totalResults: 2,
          vacancies: [
            { ...vacancy, compensation: { currencyCode: 'RUR', from: 340000, gross: false } },
            {
              ...vacancy,
              vacancyId: 2,
              links: { desktop: 'https://hh.ru/vacancy/2' },
              compensation: { currencyCode: 'RUR', to: 200000, gross: true },
            },
          ],
        },
      }),
      context,
    );

    expect(result.vacancies[0].salary).toEqual({ from: 340000, currency: 'RUR', gross: false });
    expect(result.vacancies[1].salary).toEqual({ to: 200000, currency: 'RUR', gross: true });
  });

  it('удалённость читается из формата работы, а не из названия', () => {
    const onSite = parseHhSearchState(
      pageWith({
        vacancySearchResult: {
          totalResults: 1,
          vacancies: [{ ...vacancy, workFormats: [{ workFormatsElement: ['ON_SITE'] }] }],
        },
      }),
      context,
    );
    const hybrid = parseHhSearchState(
      pageWith({
        vacancySearchResult: {
          totalResults: 1,
          vacancies: [{ ...vacancy, workFormats: [{ workFormatsElement: ['ON_SITE', 'REMOTE'] }] }],
        },
      }),
      context,
    );

    expect(onSite.vacancies[0].isRemote).toBe(false);
    expect(hybrid.vacancies[0].isRemote).toBe(true);
  });

  it('читает страницу, экранированную числовыми ссылками (как на живой площадке)', () => {
    const result = parseHhSearchState(
      pageWithNumericEntities({
        vacancySearchResult: { totalResults: 1319, vacancies: [vacancy] },
      }),
      context,
    );

    expect(result.totalResults).toBe(1319);
    expect(result.vacancies[0].title).toBe('Автотестировщик в крауд-тестирование');
    expect(result.vacancies[0].company).toBe('Яндекс Крауд');
  });

  it('шестнадцатеричные ссылки тоже читаются', () => {
    const result = parseHhSearchState(
      `<template id="HH-Lux-InitialState">${JSON.stringify({
        vacancySearchResult: { totalResults: 1, vacancies: [vacancy] },
      }).replaceAll('"', '&#x22;')}</template>`,
      context,
    );

    expect(result.vacancies).toHaveLength(1);
  });

  it('экранированный амперсанд не разъезжается и не рвёт JSON', () => {
    // Текст, где площадка буквально написала «&#34;»: на странице он приходит
    // как «&#38;#34;». Разбор в один проход обязан дать «&#34;» и оставить JSON
    // читаемым — два последовательных прохода вставили бы сюда кавычку и
    // порвали бы разбор всей страницы.
    const result = parseHhSearchState(
      pageWithNumericEntities({
        vacancySearchResult: {
          totalResults: 1,
          vacancies: [{ ...vacancy, name: 'QA &#34; инженер' }],
        },
      }),
      context,
    );

    expect(result.vacancies).toHaveLength(1);
    // Кавычку раскрывает уже `htmlToFeedText` — общее правило для текста лент.
    expect(result.vacancies[0].title).toBe('QA " инженер');
  });

  it('пустая выдача — это ноль вакансий, а не поломка', () => {
    const result = parseHhSearchState(
      pageWith({ vacancySearchResult: { totalResults: 0, vacancies: [] } }),
      context,
    );

    expect(result.totalResults).toBe(0);
    expect(result.vacancies).toEqual([]);
  });

  it('запись без ссылки или названия выбрасывается, а не показывается пустой', () => {
    const result = parseHhSearchState(
      pageWith({
        vacancySearchResult: {
          totalResults: 3,
          vacancies: [
            vacancy,
            { ...vacancy, vacancyId: 7, name: '', links: { desktop: 'https://hh.ru/vacancy/7' } },
            { ...vacancy, vacancyId: 8, links: {} },
          ],
        },
      }),
      context,
    );

    expect(result.vacancies).toHaveLength(1);
  });

  it('страница без состояния — нечитаемый ответ, а не пустая выдача', () => {
    expect(() => parseHhSearchState('<html><body>капча</body></html>', context)).toThrow(
      HH_STATE_UNREADABLE,
    );
  });

  it('состояние без блока поиска — тоже нечитаемый ответ', () => {
    expect(() => parseHhSearchState(pageWith({ somethingElse: {} }), context)).toThrow(
      HH_STATE_UNREADABLE,
    );
  });

  it('неизвестный работодатель не выдумывается', () => {
    const result = parseHhSearchState(
      pageWith({
        vacancySearchResult: { totalResults: 1, vacancies: [{ ...vacancy, company: {} }] },
      }),
      context,
    );

    expect(result.vacancies).toHaveLength(0);
  });
});
