import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';

/**
 * Частичное чтение не имеет права заменять срез источника (B214).
 *
 * Обход hh.ru раздвоен: глубокий проход видит всю выдачу, быстрый — только
 * свежие сутки. Правило «успешный опрос заменяет срез» (B161) верно для
 * полного чтения и разрушительно для частичного: на проде быстрый проход
 * заменил 36 376 собранных вакансий на 1 464 прочитанных за сутки.
 */

const SOURCE: VacancySourceConfig = {
  id: 'src-hh-search',
  name: 'hh.ru (страница поиска)',
  type: 'hh_search',
  enabled: true,
  targetUrl: 'https://hh.ru/search/vacancy',
  refreshIntervalMinutes: 20,
  itemsFoundTotal: 0,
  itemsActiveTotal: 0,
};

function vacancy(id: number): UnifiedVacancy {
  return {
    id: `src-hh-search:${id}`,
    fingerprint: `src-hh-search:${id}`,
    title: `Вакансия ${id}`,
    company: 'Компания',
    isRemote: false,
    description: '',
    requiredSkills: [],
    url: `https://hh.ru/vacancy/${id}`,
    provenance: {
      sourceType: 'json_api',
      sourceId: 'src-hh-search',
      sourceUrl: `https://hh.ru/vacancy/${id}`,
      observedAt: new Date().toISOString(),
    },
    publishedAt: new Date().toISOString(),
    status: 'active',
  };
}

function engineWith(fetcher: Parameters<typeof buildEngine>[0]) {
  return buildEngine(fetcher);
}

function buildEngine(
  fetcher: (
    source: VacancySourceConfig,
  ) => Promise<UnifiedVacancy[] | { vacancies: UnifiedVacancy[]; partial: boolean }>,
) {
  return new MultiSourceVacancyEngine({
    sources: [SOURCE],
    fetcher: fetcher as never,
  });
}

describe('частичное чтение источника', () => {
  it('полное чтение по-прежнему заменяет срез', async () => {
    let batch: UnifiedVacancy[] = [vacancy(1), vacancy(2), vacancy(3)];
    const engine = engineWith(async () => batch);

    await engine.syncSource('src-hh-search');
    expect(engine.getVacancies().total).toBe(3);

    // Вакансию сняли: полное чтение её больше не видит, и она обязана уйти.
    batch = [vacancy(1)];
    await engine.syncSource('src-hh-search');
    expect(engine.getVacancies().total).toBe(1);
  });

  it('частичное чтение добавляет, а не заменяет', async () => {
    let reading: { vacancies: UnifiedVacancy[]; partial: boolean } = {
      vacancies: [vacancy(1), vacancy(2), vacancy(3)],
      partial: false,
    };
    const engine = engineWith(async () => reading);

    await engine.syncSource('src-hh-search');
    expect(engine.getVacancies().total).toBe(3);

    reading = { vacancies: [vacancy(4)], partial: true };
    await engine.syncSource('src-hh-search');

    // Три прежние остались, четвёртая добавилась.
    expect(engine.getVacancies().total).toBe(4);
  });

  it('частичное чтение обновляет запись, а не задваивает её', async () => {
    let reading: { vacancies: UnifiedVacancy[]; partial: boolean } = {
      vacancies: [vacancy(1)],
      partial: false,
    };
    const engine = engineWith(async () => reading);
    await engine.syncSource('src-hh-search');

    reading = {
      vacancies: [{ ...vacancy(1), title: 'Новое название' }],
      partial: true,
    };
    await engine.syncSource('src-hh-search');

    const items = engine.getVacancies().items;
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Новое название');
  });

  it('счётчик источника называет размер среза, а не размер частичного чтения', async () => {
    let reading: { vacancies: UnifiedVacancy[]; partial: boolean } = {
      vacancies: [vacancy(1), vacancy(2), vacancy(3)],
      partial: false,
    };
    const engine = engineWith(async () => reading);
    await engine.syncSource('src-hh-search');

    reading = { vacancies: [vacancy(4)], partial: true };
    await engine.syncSource('src-hh-search');

    expect(engine.getSource('src-hh-search')?.itemsFoundTotal).toBe(4);
  });

  it('улов, отданный простым списком, считается полным чтением', async () => {
    const engine = engineWith(async () => [vacancy(1)]);

    const outcome = await engine.syncSource('src-hh-search');

    expect(outcome.status).toBe('healthy');
    expect(engine.getVacancies().total).toBe(1);
  });
});
