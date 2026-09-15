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

function vacancy(id: number, observedAt = new Date().toISOString()): UnifiedVacancy {
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
      observedAt,
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
  ) => Promise<
    | UnifiedVacancy[]
    | { vacancies: UnifiedVacancy[]; partial: boolean; dropObservedBefore?: string }
  >,
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

  it('последний тик глубокого прохода снимает то, чего пул не видел с его начала (B219)', async () => {
    const before = '2026-09-14T10:00:00.000Z';
    const sweepStart = '2026-09-15T06:00:00.000Z';
    const during = '2026-09-15T08:00:00.000Z';
    let reading: { vacancies: UnifiedVacancy[]; partial: boolean; dropObservedBefore?: string } = {
      vacancies: [vacancy(1, before), vacancy(2, before), vacancy(3, before)],
      partial: false,
    };
    const engine = engineWith(async () => reading);
    await engine.syncSource('src-hh-search');

    // Тики прохода перечитали 1 и 2 и нашли 4; вакансию 3 площадка больше не показывает.
    reading = { vacancies: [vacancy(1, during), vacancy(2, during)], partial: true };
    await engine.syncSource('src-hh-search');
    reading = { vacancies: [vacancy(4, during)], partial: true, dropObservedBefore: sweepStart };
    await engine.syncSource('src-hh-search');

    const ids = engine
      .getVacancies()
      .items.map((v) => v.id)
      .sort();
    expect(ids).toEqual(['src-hh-search:1', 'src-hh-search:2', 'src-hh-search:4']);
    expect(engine.getSource('src-hh-search')?.itemsFoundTotal).toBe(3);
  });

  it('снятие невиденного не трогает чужие срезы', async () => {
    const other: VacancySourceConfig = { ...SOURCE, id: 'src-other', name: 'Другая' };
    const otherVacancy: UnifiedVacancy = {
      ...vacancy(9, '2026-09-14T10:00:00.000Z'),
      id: 'src-other:9',
      fingerprint: 'src-other:9',
      provenance: { ...vacancy(9).provenance!, sourceId: 'src-other' },
    };
    const engine = new MultiSourceVacancyEngine({
      sources: [SOURCE, other],
      fetcher: (async (source: VacancySourceConfig) =>
        source.id === 'src-other'
          ? [otherVacancy]
          : {
              vacancies: [vacancy(1, '2026-09-15T08:00:00.000Z')],
              partial: true,
              dropObservedBefore: '2026-09-15T06:00:00.000Z',
            }) as never,
    });

    await engine.syncSource('src-other');
    await engine.syncSource('src-hh-search');

    expect(engine.getVacancies().total).toBe(2);
  });
});
