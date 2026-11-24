import { describe, expect, it } from 'vitest';
import { isHhSource, preferredApplySource } from './hhVacancySource';

const getmatch = {
  sourceType: 'json_api',
  sourceId: 'src-getmatch',
  sourceName: 'Getmatch',
  sourceUrl: 'https://getmatch.ru/vacancies/7',
};
const hh = {
  sourceType: 'json_api',
  sourceId: 'hh',
  sourceName: 'hh.ru (страница поиска)',
  sourceUrl: 'https://perm.hh.ru/vacancy/139180469',
};

describe('B678: площадка отклика', () => {
  it('hh.ru узнаётся по типу, id, адресу и имени', () => {
    expect(isHhSource(hh)).toBe(true);
    expect(isHhSource({ sourceType: 'hh' })).toBe(true);
    expect(isHhSource({ sourceType: 'json_api', sourceUrl: hh.sourceUrl })).toBe(true);
    expect(isHhSource({ sourceName: 'hh.ru' })).toBe(true);
    expect(isHhSource(getmatch)).toBe(false);
    expect(isHhSource({ sourceUrl: 'https://nothh.ru/vacancy/1' })).toBe(false);
  });

  it('hh.ru первым при любом порядке, адрес — вакансии на hh.ru', () => {
    for (const sources of [[getmatch, hh], [hh, getmatch]]) {
      expect(preferredApplySource({ sources, primaryUrl: getmatch.sourceUrl })).toEqual({
        source: hh.sourceName,
        url: hh.sourceUrl,
        hh: true,
      });
    }
  });

  it('из двух источников hh.ru — тот, чей адрес ведёт на вакансию', () => {
    const search = { ...hh, sourceUrl: 'https://hh.ru/search/vacancy?text=cto' };
    expect(preferredApplySource({ sources: [search, hh], primaryUrl: '' }).url).toBe(hh.sourceUrl);
    expect(preferredApplySource({ sources: [search], primaryUrl: hh.sourceUrl }).url).toBe(hh.sourceUrl);
  });

  it('без hh.ru — первый источник и основная ссылка', () => {
    expect(preferredApplySource({ sources: [getmatch], primaryUrl: 'https://example.com/7' })).toEqual({
      source: 'Getmatch',
      url: 'https://example.com/7',
      hh: false,
    });
    expect(preferredApplySource({ sources: [], primaryUrl: 'https://example.com/7' }).source).toBeUndefined();
  });
});
