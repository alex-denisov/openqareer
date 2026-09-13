import { describe, expect, it, vi } from 'vitest';
import { HhCrawlCoordinator, FULL_SWEEP_INTERVAL_MS } from './hhCrawlCoordinator';
import type { HhCrawlSettingsStore, HhCrawlSettingsValue } from './hhCrawlSettings';

function settingsStore(value: Partial<HhCrawlSettingsValue> = {}) {
  const state: HhCrawlSettingsValue = {
    roleIds: ['96', '124'],
    searchPeriodDays: 30,
    ...value,
  };
  const marked: string[] = [];
  const store: HhCrawlSettingsStore = {
    read: () => state,
    saveRoles: () => undefined,
    markFullSweep: (at) => void marked.push(at),
  };
  return { store, marked };
}

function page(ids: number[]): string {
  const vacancies = ids.map((id) => ({
    vacancyId: id,
    name: `Вакансия ${id}`,
    area: { name: 'Москва' },
    company: { name: 'Компания' },
    compensation: { noCompensation: {} },
    publicationTime: { $: '2026-09-13T10:00:00.000+03:00' },
    links: { desktop: `https://hh.ru/vacancy/${id}` },
    workFormats: [{ workFormatsElement: ['ON_SITE'] }],
  }));
  return `<template id="HH-Lux-InitialState">${JSON.stringify({
    vacancySearchResult: { totalResults: ids.length, vacancies },
  }).replaceAll('"', '&#34;')}</template>`;
}

const okTransport = async () => ({ status: 200, body: page([1, 2]) });
const sleep = () => Promise.resolve();

describe('HhCrawlCoordinator', () => {
  it('без отметки полного прохода делает глубокий обход', async () => {
    const { store, marked } = settingsStore();
    const fetchPage = vi.fn(okTransport);
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage,
      sleep,
      now: () => new Date('2026-09-13T12:00:00.000Z'),
    });

    const result = await coordinator.collect();

    expect(result.mode).toBe('full');
    expect(marked).toEqual(['2026-09-13T12:00:00.000Z']);
    expect(result.vacancies.length).toBeGreaterThan(0);
  });

  it('сразу после глубокого прохода делает быстрый', async () => {
    const { store, marked } = settingsStore({
      lastFullSweepAt: '2026-09-13T11:00:00.000Z',
    });
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage: vi.fn(okTransport),
      sleep,
      now: () => new Date('2026-09-13T12:00:00.000Z'),
    });

    const result = await coordinator.collect();

    expect(result.mode).toBe('fresh');
    // Быстрый проход отметку не двигает: глубина должна наступить по сроку.
    expect(marked).toEqual([]);
  });

  it('когда срок глубокого прохода вышел — снова глубокий', async () => {
    const last = new Date('2026-09-13T12:00:00.000Z');
    const { store } = settingsStore({ lastFullSweepAt: last.toISOString() });
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage: vi.fn(okTransport),
      sleep,
      now: () => new Date(last.getTime() + FULL_SWEEP_INTERVAL_MS + 1),
    });

    expect((await coordinator.collect()).mode).toBe('full');
  });

  it('быстрый проход спрашивает только свежие сутки', async () => {
    const { store } = settingsStore({ lastFullSweepAt: '2026-09-13T11:00:00.000Z' });
    const seen: string[] = [];
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage: async (url) => {
        seen.push(url);
        return { status: 200, body: page([1]) };
      },
      sleep,
      now: () => new Date('2026-09-13T12:00:00.000Z'),
    });

    await coordinator.collect();

    expect(seen.every((url) => new URL(url).searchParams.get('search_period') === '1')).toBe(true);
  });

  it('глубокий проход спрашивает срок из настроек', async () => {
    const { store } = settingsStore({ searchPeriodDays: 14 });
    const seen: string[] = [];
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage: async (url) => {
        seen.push(url);
        return { status: 200, body: page([1]) };
      },
      sleep,
      now: () => new Date('2026-09-13T12:00:00.000Z'),
    });

    await coordinator.collect();

    expect(seen.every((url) => new URL(url).searchParams.get('search_period') === '14')).toBe(true);
  });

  it('обход спрашивает каждую выбранную роль', async () => {
    const { store } = settingsStore({
      roleIds: ['96', '124', '113'],
      lastFullSweepAt: '2026-09-13T11:00:00.000Z',
    });
    const roles = new Set<string>();
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage: async (url) => {
        roles.add(new URL(url).searchParams.get('professional_role') ?? '');
        return { status: 200, body: page([1]) };
      },
      sleep,
      now: () => new Date('2026-09-13T12:00:00.000Z'),
    });

    await coordinator.collect();

    expect([...roles].sort()).toEqual(['113', '124', '96']);
  });

  it('провалившийся глубокий проход отметку не ставит', async () => {
    const { store, marked } = settingsStore();
    const coordinator = new HhCrawlCoordinator(store, {
      fetchPage: async () => ({ status: 429, body: '' }),
      sleep,
      now: () => new Date('2026-09-13T12:00:00.000Z'),
    });

    await expect(coordinator.collect()).rejects.toThrow();
    expect(marked).toEqual([]);
  });
});
