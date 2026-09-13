import { describe, expect, it, vi } from 'vitest';
import { buildHhSearchUrl, fetchHhSearch, HH_SEARCH_BLOCKED } from './hhSearchFetcher';

const page = (vacancies: unknown[], totalResults = vacancies.length) =>
  `<template id="HH-Lux-InitialState">${JSON.stringify({
    vacancySearchResult: { totalResults, vacancies },
  }).replaceAll('"', '&#34;')}</template>`;

const vacancy = {
  vacancyId: 1,
  name: 'QA Engineer',
  area: { name: 'Москва' },
  company: { name: 'Тест' },
  compensation: { noCompensation: {} },
  publicationTime: { $: '2026-09-13T10:00:00.000+03:00' },
  links: { desktop: 'https://hh.ru/vacancy/1' },
  workFormats: [{ workFormatsElement: ['REMOTE'] }],
};

const source = {
  id: 'src-hh-search',
  name: 'hh.ru (поиск)',
  type: 'hh_search' as const,
  enabled: true,
  targetUrl: 'https://hh.ru/search/vacancy',
  refreshIntervalMinutes: 60,
  itemsFoundTotal: 0,
  itemsActiveTotal: 0,
};

describe('buildHhSearchUrl', () => {
  it('собирает адрес поиска с запросом, регионом и страницей', () => {
    const url = new URL(buildHhSearchUrl({ query: 'qa', area: '113', page: 2 }));

    expect(url.origin + url.pathname).toBe('https://hh.ru/search/vacancy');
    expect(url.searchParams.get('text')).toBe('qa');
    expect(url.searchParams.get('area')).toBe('113');
    expect(url.searchParams.get('page')).toBe('2');
  });

  it('по умолчанию берёт всю Россию и первую страницу', () => {
    const url = new URL(buildHhSearchUrl({ query: 'qa' }));

    expect(url.searchParams.get('area')).toBe('113');
    expect(url.searchParams.get('page')).toBe('0');
  });

  it('запрос без текста допустим — это вся выдача региона', () => {
    const url = new URL(buildHhSearchUrl({}));

    expect(url.searchParams.has('text')).toBe(false);
  });
});

describe('fetchHhSearch', () => {
  it('читает вакансии через переданный транспорт', async () => {
    const transport = vi.fn().mockResolvedValue({ status: 200, body: page([vacancy], 1319) });

    const result = await fetchHhSearch(source, { query: 'qa' }, { transport, observedAt: 'NOW' });

    expect(result.totalResults).toBe(1319);
    expect(result.vacancies).toHaveLength(1);
    expect(result.vacancies[0].title).toBe('QA Engineer');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('гео-блок площадки назван отдельной причиной, а не «пусто»', async () => {
    const transport = vi.fn().mockResolvedValue({ status: 451, body: '' });

    await expect(
      fetchHhSearch(source, { query: 'qa' }, { transport, observedAt: 'NOW' }),
    ).rejects.toThrow(HH_SEARCH_BLOCKED);
  });

  it('запасной путь используется, когда прямой отказал', async () => {
    const transport = vi.fn().mockResolvedValue({ status: 451, body: '' });
    const fallback = vi.fn().mockResolvedValue({ status: 200, body: page([vacancy]) });

    const result = await fetchHhSearch(
      source,
      { query: 'qa' },
      { transport, fallbackTransport: fallback, observedAt: 'NOW' },
    );

    expect(result.vacancies).toHaveLength(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('оба пути отказали — падает, а не отдаёт пустой успех', async () => {
    const blocked = vi.fn().mockResolvedValue({ status: 451, body: '' });

    await expect(
      fetchHhSearch(
        source,
        { query: 'qa' },
        { transport: blocked, fallbackTransport: blocked, observedAt: 'NOW' },
      ),
    ).rejects.toThrow(HH_SEARCH_BLOCKED);
  });

  it('капча вместо выдачи — нечитаемый ответ, а не ноль вакансий', async () => {
    const transport = vi.fn().mockResolvedValue({ status: 200, body: '<html>captcha</html>' });

    await expect(
      fetchHhSearch(source, { query: 'qa' }, { transport, observedAt: 'NOW' }),
    ).rejects.toThrow();
  });

  it('пустая выдача — это честный ноль', async () => {
    const transport = vi.fn().mockResolvedValue({ status: 200, body: page([], 0) });

    const result = await fetchHhSearch(source, { query: 'неттакого' }, { transport, observedAt: 'NOW' });

    expect(result.vacancies).toEqual([]);
    expect(result.totalResults).toBe(0);
  });
});
