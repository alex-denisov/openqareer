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

/**
 * Ручной отклик в строке пула (B165, срез 1, узлы 6 и 8).
 *
 * «Открыть» уводит на площадку под сессией кандидата (ADR-009), отклик там
 * делает он сам, и подтверждает его тоже он: платформа не имеет права
 * записать отклик за него.
 */
describe('VacancyBoard · ручной отклик', () => {
  const item = {
    cluster: {
      id: 'c1',
      canonicalTitle: 'Продуктовый аналитик',
      canonicalCompany: 'FinCloud',
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
      ],
      firstObservedAt: '2026-09-01T10:00:00.000Z',
      lastSeenAt: '2026-09-01T10:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
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

  const pool = {
    matched: [item],
    total: 1,
    poolTotal: 1,
    loading: false,
    failed: false,
    complete: true,
  };

  it('предлагает подтвердить отклик, пока он не подтверждён', () => {
    const html = renderToStaticMarkup(<VacancyBoard pool={pool} applications={[]} />);

    expect(html).toContain('Я откликнулся');
    expect(html).not.toContain('Отклик подтверждён');
  });

  it('подтверждённый отклик назван датой, а не значком, и кнопки больше нет', () => {
    const html = renderToStaticMarkup(
      <VacancyBoard
        pool={pool}
        applications={[
          {
            clusterId: 'c1',
            status: 'applied',
            vacancy: {
              title: 'Продуктовый аналитик',
              company: 'FinCloud',
              url: 'https://example.test/1',
              source: 'himalayas',
            },
            openedAt: '2026-09-02T08:00:00.000Z',
            appliedAt: '2026-09-02T09:00:00.000Z',
            confirmedBy: 'candidate',
          },
        ]}
      />,
    );

    expect(html).toContain('Отклик подтверждён');
    expect(html).toContain('2 сентября');
    expect(html).not.toContain('Я откликнулся');
  });

  it('отображает переключатель видов (Список и На карте) с честным знаменателем B192', () => {
    const itemWithFeatures = {
      ...item,
      cluster: {
        ...item.cluster,
        companyFeatures: {
          relocation: true,
          currencyRemote: true,
          city: 'Амстердам',
          coordinates: { lat: 52.3676, lng: 4.9041 },
        },
      },
    };
    const html = renderToStaticMarkup(
      <VacancyBoard
        pool={{
          matched: [itemWithFeatures],
          total: 1,
          poolTotal: 1,
          loading: false,
          failed: false,
          complete: true,
        }}
        applications={[]}
      />,
    );

    expect(html).toContain('Список (1)');
    expect(html).toContain('На карте (1 из 1)');
    expect(html).toContain('Релокация (1 из 1)');
    expect(html).toContain('Валюта (1 из 1)');
    expect(html).toContain('✈️ Релокация');
    expect(html).toContain('💵 Валюта');
  });

  it('рендерит кнопку «Подготовить отклик» в действиях строки вакансии', () => {
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
        applications={[]}
      />,
    );

    expect(html).toContain('career-vacancy-pitch-btn');
    expect(html).toContain('Подготовить отклик');
  });

  it('рендерит кнопку «К интервью» для подготовки к собеседованию', () => {
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
        applications={[]}
      />,
    );

    expect(html).toContain('career-vacancy-prep-btn');
    expect(html).toContain('К интервью');
  });
});


/**
 * B232. Подбор из 96–397 записей рендерился целиком: 5 108 текстовых узлов
 * на одном экране. Список показывает первые 20 и предлагает следующие 20.
 */
describe('VacancyBoard · страница из 20 записей', () => {
  const pool = {
    matched: Array.from({ length: 96 }, (_, index) => ({
      cluster: {
        id: `c${index}`,
        canonicalTitle: `Вакансия ${index}`,
        canonicalCompany: 'FinCloud',
        canonicalLocation: 'Удалённо',
        isRemote: true,
        descriptionSummary: '',
        skills: [],
        primaryUrl: `https://example.test/${index}`,
        sources: [
          {
            sourceType: 'rss',
            sourceId: 'himalayas',
            sourceName: 'Himalayas',
            sourceUrl: `https://example.test/${index}`,
            observedAt: '2026-09-01T10:00:00.000Z',
          },
        ],
        firstObservedAt: '2026-09-01T10:00:00.000Z',
        lastSeenAt: '2026-09-01T10:00:00.000Z',
        status: 'active',
        vacanciesCount: 1,
      },
      explanation: {
        clusterId: `c${index}`,
        roleMatch: 'target',
        matchingPoints: [],
        missingPoints: [],
        summary: '',
        calculatedAt: '2026-09-01T10:00:00.000Z',
      },
    })) as unknown as MatchedVacancyItem[],
    total: 96,
    poolTotal: 96,
    loading: false,
    failed: false,
    complete: true,
  };

  it('рендерит 20 строк из 96 и называет, сколько осталось', () => {
    const html = renderToStaticMarkup(<VacancyBoard pool={pool} />);
    expect(html.match(/class="career-vacancy-row"/g)).toHaveLength(20);
    expect(html).toContain('Вакансия 19');
    expect(html).not.toContain('Вакансия 20<');
    expect(html).toContain('Показать ещё 20');
    expect(html).toContain('показано 20 из 96');
  });
});
