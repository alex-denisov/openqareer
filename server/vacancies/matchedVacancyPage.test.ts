import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import type { MatchedVacancyPage } from './matchedVacancyPage';
import {
  MATCHED_PAGE_BYTE_BUDGET,
  buildMatchedVacancyPage,
  planMatchedVacancyPages,
} from './matchedVacancyPage';

/**
 * Прод отдавал подбор одним куском в 794 319 байт, а маршрут владельца рвёт
 * соединение примерно на 20 460 байт: экран не получал ни одной вакансии
 * (INC-029). Страница обязана помещаться в бюджет, а не надеяться на канал.
 */
function item(index: number): MatchedVacancyItem {
  return {
    cluster: {
      id: `cluster-${index}`,
      canonicalTitle: `Ведущий инженер по данным ${index}`,
      canonicalCompany: `Компания ${index} с довольно длинным названием`,
      canonicalLocation: 'Москва',
      isRemote: index % 2 === 0,
      salary: { from: 250_000, to: 400_000, currency: 'RUR', gross: true },
      descriptionSummary: 'Описание вакансии. '.repeat(60),
      skills: Array.from({ length: 40 }, (_, s) => `навык-${index}-${s}`),
      primaryUrl: `https://example.test/vacancy/${index}`,
      sources: [
        {
          sourceType: 'remotive',
          sourceId: 'remotive',
          sourceUrl: `https://remotive.test/${index}`,
          externalId: `${index}`,
          observedAt: '2026-08-30T10:00:00.000Z',
        },
      ],
      firstObservedAt: '2026-08-30T10:00:00.000Z',
      lastSeenAt: '2026-09-01T10:00:00.000Z',
      status: 'active',
      vacanciesCount: 2,
    },
    explanation: {
      clusterId: `cluster-${index}`,
      roleMatch: 'target' as const,
      levelMatch: 'unknown' as const,
      requirements: { matched: 12, total: 52 },
      matchingPoints: Array.from({ length: 12 }, (_, p) => `Подтверждённый навык: навык-${p}`),
      missingPoints: Array.from({ length: 40 }, (_, p) => `навык-${index}-${p}`),
      summary: 'Совпало 12 из 52 требований вакансии. Название совпадает с целевой ролью.',
      calculatedAt: '2026-09-01T10:00:00.000Z',
    },
  };
}

describe('buildMatchedVacancyPage', () => {
  const pool = Array.from({ length: 500 }, (_, index) => item(index));

  it('держит страницу внутри байтового бюджета маршрута', () => {
    const page = buildMatchedVacancyPage(pool, 0);
    const size = Buffer.byteLength(JSON.stringify(page.items), 'utf8');
    expect(size).toBeLessThanOrEqual(MATCHED_PAGE_BYTE_BUDGET);
    expect(page.items.length).toBeGreaterThan(0);
  });

  it('говорит, сколько всего в подборе и где продолжить', () => {
    const page = buildMatchedVacancyPage(pool, 0);
    expect(page.total).toBe(500);
    expect(page.nextOffset).toBe(page.items.length);
  });

  it('доходит до конца пула страницами и не теряет ни одной записи', () => {
    const seen: string[] = [];
    let offset: number | null = 0;
    let pages = 0;
    while (offset !== null) {
      const page = buildMatchedVacancyPage(pool, offset);
      seen.push(...page.items.map((entry) => entry.cluster.id));
      offset = page.nextOffset;
      pages += 1;
      expect(pages).toBeLessThan(200);
    }
    expect(seen).toEqual(pool.map((entry) => entry.cluster.id));
  });

  it('отдаёт хотя бы одну запись, даже если она сама больше бюджета', () => {
    const page = buildMatchedVacancyPage(pool, 0, 10);
    expect(page.items).toHaveLength(1);
    expect(page.nextOffset).toBe(1);
  });

  it('сохраняет счёт покрытия, обрезая списки до видимых трёх', () => {
    const [first] = buildMatchedVacancyPage(pool, 0).items;
    expect(first.explanation.matchingPoints.length).toBeLessThanOrEqual(3);
    expect(first.explanation.missingPoints.length).toBeLessThanOrEqual(3);
    // Покрытие считается по числам, а не по длине обрезанных списков: иначе
    // карточка показала бы «3 из 6» там, где на деле 12 из 52.
    expect(first.explanation.matchingCount).toBe(12);
    expect(first.explanation.missingCount).toBe(40);
  });

  it('не тащит поля, которых нет в интерфейсе', () => {
    const [first] = buildMatchedVacancyPage(pool, 0).items;
    expect(first.cluster.descriptionSummary).toBe('');
    expect(first.cluster.skills).toEqual([]);
    // Интерфейс печатает не больше трёх недостающих требований.
    expect(first.explanation.missingPoints.length).toBeLessThanOrEqual(3);
  });

  it('пустой пул — честно пустая страница, а не бесконечное продолжение', () => {
    const page = buildMatchedVacancyPage([], 0);
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.nextOffset).toBeNull();
  });

  it('обогащает вакансию фишками компании и координатами при наличии данных в реестре', () => {
    const miroItem: MatchedVacancyItem = {
      cluster: {
        id: 'cluster-miro',
        canonicalTitle: 'Senior Frontend Engineer',
        canonicalCompany: 'Miro',
        canonicalLocation: 'Amsterdam, Netherlands',
        isRemote: false,
        salary: { from: 100_000, to: 150_000, currency: 'EUR', gross: true },
        descriptionSummary: 'Full description',
        skills: ['React', 'TS'],
        primaryUrl: 'https://miro.com/careers/frontend',
        sources: [],
        firstObservedAt: '2026-09-01T00:00:00.000Z',
        lastSeenAt: '2026-09-06T00:00:00.000Z',
        status: 'active',
        vacanciesCount: 1,
      },
      explanation: {
        clusterId: 'cluster-miro',
        roleMatch: 'target',
        levelMatch: 'unknown',
        requirements: { matched: 2, total: 2 },
        matchingPoints: ['React', 'TS'],
        missingPoints: [],
        summary: '2 из 2',
        calculatedAt: '2026-09-06T00:00:00.000Z',
      },
    };

    const page = buildMatchedVacancyPage([miroItem], 0);
    const enriched = page.items[0];
    expect(enriched.cluster.companyFeatures).toBeDefined();
    expect(enriched.cluster.companyFeatures?.relocation).toBe(true);
    expect(enriched.cluster.companyFeatures?.atsProvider).toBe('ashby');
    expect(enriched.cluster.companyFeatures?.coordinates).toBeDefined();
    expect(enriched.cluster.companyFeatures?.coordinates?.lat).toBeCloseTo(52.3676, 1);
  });
});

describe('место вакансии на карте называется честно (B203)', () => {
  function withLocation(location: string): MatchedVacancyItem {
    const base = item(0);
    return { ...base, cluster: { ...base.cluster, canonicalLocation: location } };
  }

  it('страна в поле места городским хабом не становится', () => {
    const [first] = buildMatchedVacancyPage([withLocation('Italy')], 0).items;
    expect(first?.cluster.companyFeatures?.city).toBeUndefined();
    expect(first?.cluster.companyFeatures?.country).toBe('Italy');
  });

  it('страновая приставка площадки снимается с названия города', () => {
    const [first] = buildMatchedVacancyPage(
      [withLocation('US - San Francisco, United States')],
      0,
    ).items;
    expect(first?.cluster.companyFeatures?.city).toBe('San Francisco');
  });

  it('перечисление стран местом на карте не считается', () => {
    const [first] = buildMatchedVacancyPage(
      [withLocation('Germany (Remote) ; Ireland (Remote) ; Portugal (Remote)')],
      0,
    ).items;
    expect(first?.cluster.companyFeatures?.city).toBeUndefined();
  });
});

/**
 * Шестьдесят страниц читались шестьюдесятью кругами по каналу: следующее
 * смещение было известно только из предыдущего ответа (PRB-023). Первая
 * страница обязана назвать смещения всех остальных, и названный план обязан
 * совпасть с фактическим обходом — иначе клиент попросит страницу, которой нет.
 */
describe('план страниц подбора (B211)', () => {
  const pool = Array.from({ length: 500 }, (_, index) => item(index));

  it('план совпадает со смещениями фактического обхода', () => {
    const walked: number[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      walked.push(offset);
      const page: MatchedVacancyPage = buildMatchedVacancyPage(pool, offset);
      offset = page.nextOffset;
      expect(walked.length).toBeLessThan(200);
    }
    expect(planMatchedVacancyPages(pool)).toEqual(walked);
  });

  it('первая страница называет смещения всех страниц', () => {
    const page = buildMatchedVacancyPage(pool, 0);
    expect(page.pageOffsets).toEqual(planMatchedVacancyPages(pool));
    expect(page.pageOffsets?.[0]).toBe(0);
    expect(page.pageOffsets?.length).toBeGreaterThan(1);
  });

  it('страница из середины списка смещений не несёт', () => {
    const first = buildMatchedVacancyPage(pool, 0);
    const second = buildMatchedVacancyPage(pool, first.nextOffset ?? 0);
    expect(second.pageOffsets).toBeUndefined();
  });

  it('пустой пул — одна страница в плане, а не ноль', () => {
    expect(planMatchedVacancyPages([])).toEqual([0]);
    expect(buildMatchedVacancyPage([], 0).pageOffsets).toEqual([0]);
  });
});
