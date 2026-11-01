import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { clusterBatchByKeys } from './keyedClusterer';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { clusterProjectionOf } from './vacancyPoolQuery';
import { clusterVacancies } from './vacancyDeduplicator';

/**
 * 01.11: одна вакансия COO на hh под двумя написаниями работодателя («Лавка
 * Радости» и «ЛАВКА СЧАСТЬЯ» на проде, здесь обезличено) с одним и тем же
 * текстом в 1909 знаков стояла в подборке двумя карточками с разным процентом.
 * Токены работодателя расходились (Жаккар 1/3 < 0,75), и склейка запрещалась,
 * хотя название и полный текст совпадали.
 */
const TEXT = [
  'Ищем COO, который поможет вывести бизнес на новый уровень эффективности и',
  'подготовить его к следующему этапу развития. Мы развиваем франчайзинговую сеть',
  'магазинов у дома в нескольких регионах. Задачи: выстроить операционные процессы,',
  'управлять командой управляющих, отвечать за P&L сети, запускать новые точки,',
  'внедрять стандарты сервиса и контроль качества. Требования: опыт операционного',
  'руководства в ритейле от пяти лет, управление сетью от двадцати точек, сильные',
  'навыки работы с метриками. Условия: доход из оклада и бонуса за результат.',
].join(' ');

function hh(id: string, company: string, location: string, over: Partial<UnifiedVacancy> = {}) {
  const url = `https://hh.ru/vacancy/${id}`;
  const vacancy: UnifiedVacancy = {
    id: `src-hh-search:${id}`,
    fingerprint: `src-hh-search:${id}`,
    title: 'Операционный директор (COO)',
    company,
    location,
    description: '',
    requiredSkills: [],
    url,
    provenance: {
      sourceType: 'hh',
      sourceId: 'src-hh-search',
      externalId: id,
      sourceUrl: url,
      observedAt: '2026-11-01T04:49:34.596Z',
    },
    publishedAt: '2026-11-01T04:49:34.596Z',
    status: 'active',
    ...over,
  };
  return vacancy;
}

const joyMoscow = hh('900494', 'Магазин Радости', 'Москва', { fullDescription: TEXT });
const happyLipetsk = hh('900283', 'МАГАЗИН СЧАСТЬЯ', 'Липецк', { fullDescription: TEXT });

describe('одинаковый текст при разном написании работодателя', () => {
  it('сводит две записи с одним названием и одним полным текстом в один кластер', () => {
    const clusters = clusterVacancies([joyMoscow, happyLipetsk]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.vacanciesCount).toBe(2);
  });

  it('не сводит записи с одним текстом и другим названием', () => {
    const other = { ...happyLipetsk, title: 'Директор по маркетингу' };
    expect(clusterVacancies([joyMoscow, other])).toHaveLength(2);
  });

  it('не сводит записи по короткому общему тексту', () => {
    const short = 'Работа в офисе, полный день.';
    const a = { ...joyMoscow, fullDescription: short };
    const b = { ...happyLipetsk, fullDescription: short };
    expect(clusterVacancies([a, b])).toHaveLength(2);
  });

  it('сводит уже записанные кластеры, когда текст hh дочитан позже', () => {
    const pool = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    const withoutText = [
      hh('900494', 'Магазин Радости', 'Москва'),
      hh('900495', 'Магазин Радости', 'Рязань'),
      hh('900283', 'МАГАЗИН СЧАСТЬЯ', 'Липецк'),
      hh('900284', 'МАГАЗИН СЧАСТЬЯ', 'Тула'),
    ];
    pool.mergeSourceSlice('src-hh-search', withoutText);
    clusterBatchByKeys(pool, withoutText.map(clusterProjectionOf));
    expect(pool.countClusters()).toBe(2);

    const withText = withoutText.map((vacancy) => ({ ...vacancy, fullDescription: TEXT }));
    pool.mergeSourceSlice('src-hh-search', withText);
    clusterBatchByKeys(pool, withText.map(clusterProjectionOf));

    expect(pool.countClusters()).toBe(1);
    const [cluster] = pool.loadClusters();
    expect(cluster!.vacanciesCount).toBe(4);
    expect(cluster!.sources.map((source) => source.externalId).sort()).toEqual([
      '900283',
      '900284',
      '900494',
      '900495',
    ]);
  });
});

describe('очередь дочитанных текстов (01.11)', () => {
  it('ставит запись в очередь, когда текст впервые дочитан, и отдаёт её один раз', () => {
    const pool = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    const bare = hh('900494', 'Магазин Радости', 'Москва');
    pool.mergeSourceSlice('src-hh-search', [bare]);
    pool.mergeSourceSlice('src-hh-search', [{ ...bare, fullDescription: TEXT }]);
    expect(pool.nextClusterTextBatch(10).map((vacancy) => vacancy.id)).toEqual([bare.id]);
  });

  it('после очереди проходит по старым записям с текстом и заканчивает проход', () => {
    const pool = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    pool.mergeSourceSlice('src-hh-search', [joyMoscow, hh('900777', 'Другой', 'Тула')]);
    expect(pool.nextClusterTextBatch(10).map((vacancy) => vacancy.id)).toEqual([joyMoscow.id]);
    expect(pool.nextClusterTextBatch(10)).toEqual([]);
    expect(pool.nextClusterTextBatch(10)).toEqual([]);
  });
});
