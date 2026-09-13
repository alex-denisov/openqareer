import { describe, expect, it, vi } from 'vitest';
import { buildCrawlPlan, HH_PAGE_SIZE, HH_RESULT_CAP, planQueryUrl } from './hhCrawlPlan';

describe('planQueryUrl', () => {
  it('собирает адрес запроса из роли, опыта, региона и периода', () => {
    const url = new URL(
      planQueryUrl({ roleId: '96', experience: 'between1And3', areaId: '1' }, 30, 3),
    );

    expect(url.searchParams.get('professional_role')).toBe('96');
    expect(url.searchParams.get('experience')).toBe('between1And3');
    expect(url.searchParams.get('area')).toBe('1');
    expect(url.searchParams.get('search_period')).toBe('30');
    expect(url.searchParams.get('page')).toBe('3');
    expect(url.searchParams.get('order_by')).toBe('publication_time');
  });

  it('без опыта и региона эти параметры не ставятся вовсе', () => {
    const url = new URL(planQueryUrl({ roleId: '96' }, 30, 0));

    expect(url.searchParams.has('experience')).toBe(false);
    expect(url.searchParams.has('area')).toBe(false);
  });
});

describe('buildCrawlPlan', () => {
  it('роль в пределах потолка берётся одним запросом', async () => {
    const count = vi.fn().mockResolvedValue(120);

    const plan = await buildCrawlPlan(['96'], { countResults: count, searchPeriodDays: 30 });

    expect(plan.queries).toHaveLength(1);
    expect(plan.queries[0]).toMatchObject({ roleId: '96', totalResults: 120, pages: 3 });
    expect(count).toHaveBeenCalledTimes(1);
  });

  it('число страниц считается от числа записей, а не берётся максимумом', async () => {
    const plan = await buildCrawlPlan(['96'], {
      countResults: async () => 50,
      searchPeriodDays: 30,
    });

    expect(plan.queries[0].pages).toBe(1);
  });

  it('роль сверх потолка дробится по опыту', async () => {
    const count = vi.fn(async (q: { experience?: string }) =>
      q.experience === undefined ? 6247 : 1500,
    );

    const plan = await buildCrawlPlan(['96'], { countResults: count, searchPeriodDays: 30 });

    expect(plan.queries).toHaveLength(4);
    expect(plan.queries.map((q) => q.experience).sort()).toEqual([
      'between1And3',
      'between3And6',
      'moreThan6',
      'noExperience',
    ]);
  });

  it('часть, не влезшая и по опыту, дробится по регионам', async () => {
    const count = vi.fn(async (q: { experience?: string; areaId?: string }) => {
      if (q.experience === undefined) return 9000;
      if (q.areaId === undefined) return q.experience === 'between1And3' ? 2500 : 100;
      return 300;
    });

    const plan = await buildCrawlPlan(['96'], {
      countResults: count,
      searchPeriodDays: 30,
      areaChildren: (areaId) => (areaId === undefined ? ['1', '2'] : []),
    });

    const split = plan.queries.filter((q) => q.experience === 'between1And3');
    expect(split.map((q) => q.areaId).sort()).toEqual(['1', '2']);
    // Остальные три части опыта дробить не понадобилось.
    expect(plan.queries.filter((q) => q.areaId === undefined)).toHaveLength(3);
  });

  it('страна, не влезшая целиком, дробится на свои области', async () => {
    // Так устроено дерево площадки: 9 стран верхнего уровня, у России 89
    // областей. Одного уровня мало — почти вся выдача лежит в России.
    const count = vi.fn(async (q: { experience?: string; areaId?: string }) => {
      if (q.experience === undefined) return 9000;
      if (q.areaId === undefined) return 2500;
      if (q.areaId === '113') return 2400;
      return 200;
    });

    const plan = await buildCrawlPlan(['96'], {
      countResults: count,
      searchPeriodDays: 30,
      areaChildren: (areaId) => {
        if (areaId === undefined) return ['113', '40'];
        if (areaId === '113') return ['1', '2'];
        return [];
      },
    });

    const areas = plan.queries.map((q) => q.areaId).filter(Boolean);
    // Россия целиком в план не попадает — вместо неё её области.
    expect(areas).not.toContain('113');
    expect(areas).toContain('1');
    expect(areas).toContain('2');
    expect(areas).toContain('40');
  });

  it('пустая часть в план не попадает — запрос за нулём бессмысленен', async () => {
    const count = vi.fn(async (q: { experience?: string }) =>
      q.experience === undefined ? 3000 : q.experience === 'noExperience' ? 0 : 900,
    );

    const plan = await buildCrawlPlan(['96'], { countResults: count, searchPeriodDays: 30 });

    expect(plan.queries.every((q) => q.totalResults > 0)).toBe(true);
    expect(plan.queries).toHaveLength(3);
  });

  it('неизвестная роль в план не попадает', async () => {
    const plan = await buildCrawlPlan(['96', 'такой-роли-нет'], {
      countResults: async () => 10,
      searchPeriodDays: 30,
    });

    expect(plan.queries.map((q) => q.roleId)).toEqual(['96']);
  });

  it('план называет ожидаемое число записей и страниц целиком', async () => {
    const plan = await buildCrawlPlan(['96', '124'], {
      countResults: async () => 100,
      searchPeriodDays: 30,
    });

    expect(plan.expectedResults).toBe(200);
    expect(plan.expectedPages).toBe(4);
  });

  it('часть, которую не делит ни один срез, берётся до потолка и признаётся усечённой', async () => {
    const plan = await buildCrawlPlan(['96'], {
      countResults: async () => 9000,
      searchPeriodDays: 30,
      areaChildren: () => [],
    });

    expect(plan.queries).toHaveLength(4);
    expect(plan.queries[0].pages).toBe(HH_RESULT_CAP / HH_PAGE_SIZE);
    expect(plan.truncatedQueries).toBe(4);
  });
});

describe('дерево регионов площадки', () => {
  it('верхний уровень — страны, у России её области', async () => {
    const { hhAreaChildren } = await import('./hhAreaTree');

    expect(hhAreaChildren()).toHaveLength(9);
    expect(hhAreaChildren()).toContain('113');
    expect(hhAreaChildren('113')).toHaveLength(89);
    // Область дальше не делится — там планировщик остановится.
    expect(hhAreaChildren('1')).toEqual([]);
  });

  it('неизвестный регион детей не выдумывает', async () => {
    const { hhAreaChildren } = await import('./hhAreaTree');

    expect(hhAreaChildren('такого-нет')).toEqual([]);
  });
});
