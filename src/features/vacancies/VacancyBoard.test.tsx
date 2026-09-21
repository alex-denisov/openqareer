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
    expect(html).toContain('Сохранённые');
    expect(html).toContain('Новый запрос к площадке');
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

  it('предлагает отметить отклик, пока он не отмечен (B236 §4.4)', () => {
    const html = renderToStaticMarkup(<VacancyBoard pool={pool} applications={[]} />);

    expect(html).toContain('>Откликнулся<');
    expect(html).not.toContain('Отклик 2 сен');
    expect(html).not.toContain('Я откликнулся');
  });

  it('отмеченный отклик назван датой, а не значком, и кнопки больше нет', () => {
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

    expect(html).toContain('Отклик 2 сент.');
    expect(html).toContain('Отклик отмечен 2 сентября');
    expect(html).not.toContain('>Откликнулся<');
    expect(html).not.toContain('Отклик подтверждён');
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
    // Чип фильтра и бейдж строки зовутся одинаково (B236 §4.5).
    expect(html).toMatch(/<span><svg[\s\S]*?<\/svg> Релокация<\/span><strong>1<\/strong>/u);
    expect(html).toMatch(/<span><svg[\s\S]*?<\/svg> Оплата в валюте<\/span><strong>1<\/strong>/u);
    expect(html).toContain('is-reloc"><svg');
    expect(html).toContain('is-currency"><svg');
    expect(html).not.toContain('Помощь с переездом');
    expect(html).not.toContain('Валютная удалёнка');
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  /**
   * B236 §4.4 (карьерный консультант): кнопки строки идут по ходу действий —
   * подготовить → тёплый вход → контакт → открыть → отметить; «Интервью»
   * последняя. Ровно одна залитая — «Открыть на …», там происходит отклик.
   * Подпись короткая, иконка привычная, объяснение — в тултипе.
   */
  it('строит кнопки строки в порядке §4.4 с одной залитой «Открыть на …»', () => {
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

    const labels = ['>Отклик<', '>Нетворкинг<', '>Рекрутер<', 'Открыть на ', '>Откликнулся<', '>Интервью<'];
    const positions = labels.map((label) => html.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    expect(html.match(/career-vacancy-action is-lead/gu)).toHaveLength(1);
    expect(html).toContain('Открыть на Himalayas');
    expect(html).not.toContain('Подготовить отклик');
    expect(html).not.toContain('Связи в LinkedIn');
    expect(html).not.toContain('К интервью');
    expect(html).not.toContain('Найти прямые контакты');
  });

  it('объясняет каждую кнопку строки тултипом, а не подписью', () => {
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

    expect(html).toContain('Копируете и отправляете сами');
    expect(html).toContain('Кому написать в компании');
    expect(html).toContain('Переход попадёт в воронку');
    expect(html).toContain('Отметьте после отклика на площадке');
    expect(html).toContain('ответы STAR по вашему опыту');
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
    expect(html).toContain('источник в подборе');
  });

  /** PRB-040: запись вне рынков кампании подписана, а не спрятана. */
  it('подписывает вакансию вне географии кампании', () => {
    const first = pool.matched[0];
    const outside = {
      ...first,
      explanation: { ...first.explanation, outsideGeography: true },
    } as unknown as MatchedVacancyItem;
    const html = renderToStaticMarkup(<VacancyBoard pool={{ ...pool, matched: [outside] }} />);
    expect(html).toContain('не в ваших регионах');
  });
});
