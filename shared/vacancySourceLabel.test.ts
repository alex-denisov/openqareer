import { describe, expect, it } from 'vitest';
import { vacancySourceDisplayName, vacancySourceLabel, vacancySourceLabels } from './vacancySourceLabel';

/** PRB-017: под вакансией стояли «json_api» и «rss, rss». */
describe('vacancySourceLabel', () => {
  it('names the platform the record came from', () => {
    expect(vacancySourceLabel({ sourceType: 'json_api', sourceName: 'Jobicy' })).toBe('Jobicy');
  });

  it('never shows the adapter type to the candidate', () => {
    expect(vacancySourceLabel({ sourceType: 'json_api' })).toBe('Открытый API');
    expect(vacancySourceLabel({ sourceType: 'rss' })).toBe('RSS-лента');
  });

  it('collapses a source repeated by every record of one cluster', () => {
    expect(
      vacancySourceLabels([
        { sourceType: 'rss', sourceName: 'Himalayas' },
        { sourceType: 'rss', sourceName: 'Himalayas' },
      ]),
    ).toEqual(['Himalayas']);
  });
});

describe('B446-r (A8): пометка канала не доходит до кандидата', () => {
  it('«hh.ru (страница поиска)» читается как hh.ru и сливается с hh.ru', () => {
    expect(
      vacancySourceLabel({ sourceType: 'hh_search', sourceName: 'hh.ru (страница поиска)' }),
    ).toBe('hh.ru');
    expect(
      vacancySourceLabels([
        { sourceType: 'hh', sourceName: 'hh.ru' },
        { sourceType: 'hh_search', sourceName: 'hh.ru (страница поиска)' },
      ]),
    ).toEqual(['hh.ru']);
  });
});

describe('Д2: служебная пометка в скобках не доходит до кандидата', () => {
  it.each([
    ['Himalayas (JSON API)', 'Himalayas'],
    ['hh.ru (страница поиска)', 'hh.ru'],
    ['hh.ru (официальный API)', 'hh.ru'],
    ['hh.ru (публичный RSS поиска)', 'hh.ru'],
    ['LinkedIn (пул аккаунтов)', 'LinkedIn'],
    ['RingCentral (LinkedIn Guest)', 'RingCentral'],
    ['Telegram @youritjob (Сербия и удаленка)', 'Telegram @youritjob'],
    ['Jobicy', 'Jobicy'],
  ])('%s → %s', (raw, clean) => {
    expect(vacancySourceDisplayName(raw)).toBe(clean);
  });

  it('оставляет имя, которое целиком в скобках: пустая строка хуже', () => {
    expect(vacancySourceDisplayName('(RSS)')).toBe('(RSS)');
  });

  it('работает и через подпись записи', () => {
    expect(vacancySourceLabel({ sourceType: 'json_api', sourceName: 'Himalayas (JSON API)' })).toBe('Himalayas');
    expect(
      vacancySourceLabels([
        { sourceType: 'rss', sourceName: 'Himalayas' },
        { sourceType: 'json_api', sourceName: 'Himalayas (JSON API)' },
      ]),
    ).toEqual(['Himalayas']);
  });
});
