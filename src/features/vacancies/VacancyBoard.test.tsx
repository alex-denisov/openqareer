import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { VacancyBoard } from './VacancyBoard';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';

/**
 * Панель фильтров «Вакансий» — единственное место, где кандидат заводит
 * регулярную выборку (B181). Она обязана быть на экране и тогда, когда пул ещё
 * пуст: иначе первую выборку завести неоткуда.
 */
describe('VacancyBoard filters', () => {
  it('держит регулярные выборки в панели фильтров, пока пул ещё читается', () => {
    const html = renderToStaticMarkup(
      <VacancyBoard
        subscriptions={[]}
        defaultQuery="Руководитель продукта"
        onRefresh={vi.fn(async () => undefined)}
      />,
    );
    expect(html).toContain('Фильтры');
    expect(html).toContain('Регулярные выборки');
  });

  /**
   * PRB-017: под вакансией стоял тип адаптера — «Aimwear · json_api»,
   * «Himalayas · rss, rss».
   */
  it('называет площадку, а не тип адаптера, и не повторяет источник дважды', () => {
    const item = {
      cluster: {
        id: 'c1',
        canonicalTitle: 'Продуктовый аналитик',
        canonicalCompany: 'Aimwear',
        canonicalLocation: 'Удалённо',
        isRemote: true,
        descriptionSummary: '',
        skills: [],
        primaryUrl: 'https://example.test/1',
        sources: [
          {
            sourceType: 'rss',
            sourceId: 'himalayas',
            sourceName: 'Himalayas',
            sourceUrl: 'https://example.test/1',
            observedAt: '2026-09-01T10:00:00.000Z',
          },
          {
            sourceType: 'rss',
            sourceId: 'himalayas',
            sourceName: 'Himalayas',
            sourceUrl: 'https://example.test/2',
            observedAt: '2026-09-01T10:00:00.000Z',
          },
        ],
        firstObservedAt: '2026-09-01T10:00:00.000Z',
        lastSeenAt: '2026-09-01T10:00:00.000Z',
        status: 'active',
        vacanciesCount: 2,
      },
      explanation: {
        clusterId: 'c1',
        roleMatch: 'target',
        requirements: { matched: 2, total: 3 },
        matchingPoints: [],
        missingPoints: [],
        summary: '',
        calculatedAt: '2026-09-01T10:00:00.000Z',
      },
    } as unknown as MatchedVacancyItem;

    const html = renderToStaticMarkup(
      <VacancyBoard
        pool={{
          matched: [item],
          total: 1,
          poolTotal: 1,
          loading: false,
          failed: false,
          complete: true,
        }}
      />,
    );

    expect(html).toContain('Aimwear · Himalayas');
    expect(html).not.toContain('rss, rss');
    expect(html).not.toContain('json_api');
  });
});
