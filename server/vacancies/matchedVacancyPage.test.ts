import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import { MATCHED_PAGE_BYTE_BUDGET, buildMatchedVacancyPage } from './matchedVacancyPage';

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
      matchScore: 100 - (index % 100),
      fitLevel: 'good',
      matchingPoints: Array.from({ length: 12 }, (_, p) => `Подтверждённый навык: навык-${p}`),
      missingPoints: Array.from({ length: 40 }, (_, p) => `навык-${index}-${p}`),
      summary: 'Хорошее совпадение. Требуются незначительные дополнения по отдельным навыкам.',
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
});
