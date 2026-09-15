import { describe, expect, it } from 'vitest';
import {
  CATALOG_STYLE,
  CATALOG_STYLESHEET_PATH,
  renderCatalogDocument,
  renderGoneDocument,
  renderVacancyDocument,
} from './vacancyCatalogDocument';
import { buildCatalogPage, buildListingPage, buildVacancyDetail } from './vacancyCatalogPage';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';

function cluster(overrides: Partial<VacancyCluster> = {}): VacancyCluster {
  return {
    id: 'board-1:cluster-1',
    canonicalTitle: 'Director, Privacy Legal',
    canonicalCompany: 'Reddit',
    canonicalLocation: 'San Francisco, USA',
    isRemote: false,
    descriptionSummary: 'Мы ищем директора по правовым вопросам приватности.',
    skills: ['Privacy'],
    primaryUrl: 'https://boards.greenhouse.io/reddit/jobs/1',
    sources: [
      {
        sourceType: 'json_api',
        sourceId: 'ats-reddit',
        sourceUrl: 'https://boards.greenhouse.io/reddit/jobs/1',
        observedAt: '2026-09-06T00:00:00.000Z',
      },
    ],
    firstObservedAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: '2026-09-06T00:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
    ...overrides,
  };
}

describe('документ публичного каталога (B209)', () => {
  it('отдаёт цельный документ с заголовком, описанием и каноническим адресом', () => {
    const html = renderCatalogDocument(buildCatalogPage([cluster()], 1));

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="ru">');
    expect(html).toMatch(/<title>[^<]+<\/title>/u);
    expect(html).toMatch(/<meta name="description" content="[^"]{40,200}">/u);
    expect(html).toContain('<link rel="canonical" href="https://openqareer.com/vacancies">');
    // Собственный небольшой файл стиля вместо пятнадцати частей таблицы
    // приложения: страница-документ не тянет вёрстку целого продукта, а
    // боевая политика `style-src 'self'` не даёт применить инлайновый стиль.
    expect(html).toContain(`<link rel="stylesheet" href="${CATALOG_STYLESHEET_PATH}">`);
    expect(html).not.toContain('<style>');
    expect(html).not.toContain('oqpart');
    expect(CATALOG_STYLE).toContain('--primary-accent');
  });

  /**
   * Названия и описания приходят с чужих площадок. Незаэкранированная кавычка
   * в названии вакансии — это чужой скрипт на нашем домене.
   */
  it('экранирует чужой текст во всех местах, включая микроразметку', () => {
    const hostile = cluster({
      canonicalTitle: 'Data Analyst <script>alert(1)</script>',
      canonicalCompany: 'Acme" onload="alert(2)',
      descriptionSummary: 'Описание </script><script>alert(3)</script>',
    });
    const detail = buildVacancyDetail(hostile)!;
    const html = renderVacancyDocument(detail);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(3)</script>');
    expect(html).not.toContain('onload="alert(2)"');
    expect(html).toContain('&lt;script&gt;');
  });

  it('печатает микроразметку списка и карточки', () => {
    expect(renderCatalogDocument(buildCatalogPage([cluster()], 1))).toContain('"@type":"ItemList"');
    expect(renderVacancyDocument(buildVacancyDetail(cluster())!)).toContain('"@type":"JobPosting"');
  });

  it('ведёт на первоисточник и называет его, а не выдаёт вакансию за свою', () => {
    const html = renderVacancyDocument(buildVacancyDetail(cluster())!);
    expect(html).toContain('https://boards.greenhouse.io/reddit/jobs/1');
    expect(html).toContain('rel="nofollow noopener"');
  });

  it('называет площадку-источник словами: условие Remotive и честность перед читателем (B217)', () => {
    const html = renderVacancyDocument(
      buildVacancyDetail(
        cluster({
          primaryUrl: 'https://remotive.com/remote-jobs/marketing/remote-office-assistant-1680495',
          sources: [
            {
              sourceType: 'json_api',
              sourceId: 'remotive',
              sourceName: 'Remotive (Global Remote)',
              sourceUrl:
                'https://remotive.com/remote-jobs/marketing/remote-office-assistant-1680495',
              observedAt: '2026-09-14T00:00:00.000Z',
            },
          ],
        }),
      )!,
    );
    expect(html).toContain('источник — Remotive (Global Remote)');
    // Без имени в реестре площадка не выдумывается.
    const nameless = renderVacancyDocument(buildVacancyDetail(cluster())!);
    expect(nameless).not.toContain('источник —');
  });

  it('печатает постраничную навигацию ссылками, а не кнопками на скрипте', () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      cluster({ id: `c${index}`, canonicalTitle: `Data Analyst ${index}` }),
    );
    const html = renderCatalogDocument(buildCatalogPage(many, 1));
    expect(html).toContain('href="/vacancies/page/2"');
    expect(html).toContain('rel="next"');
  });

  it('не тянет бандл приложения на страницу-документ', () => {
    const html = renderCatalogDocument(buildCatalogPage([cluster()], 1));
    expect(html).not.toContain('<script type="module"');
  });

  it('говорит словами, когда каталог пуст', () => {
    const html = renderCatalogDocument(buildCatalogPage([], 1));
    expect(html).toContain('Каталог пока пуст');
    expect(html).toContain('noindex');
  });

  it('называет способ работы словами во всех трёх случаях', () => {
    const remoteOnly = renderVacancyDocument(
      buildVacancyDetail(cluster({ isRemote: true, canonicalLocation: undefined }))!,
    );
    const remoteWithPlace = renderVacancyDocument(
      buildVacancyDetail(cluster({ isRemote: true, canonicalLocation: 'Берлин' }))!,
    );
    const noPlace = renderVacancyDocument(
      buildVacancyDetail(cluster({ isRemote: false, canonicalLocation: undefined }))!,
    );

    expect(remoteOnly).toContain('Удалённо');
    expect(remoteWithPlace).toContain('Удалённо · Берлин');
    expect(noPlace).toContain('Место не указано');
  });

  it('говорит «Работодатель не указан», когда площадка его не назвала', () => {
    const html = renderVacancyDocument(buildVacancyDetail(cluster({ canonicalCompany: '' }))!);
    expect(html).toContain('Работодатель не указан');
  });

  it('печатает вилку и число площадок, когда они известны', () => {
    const html = renderVacancyDocument(
      buildVacancyDetail(
        cluster({
          salary: { from: 200000, to: 300000, currency: 'RUB' },
          sources: [
            {
              sourceType: 'json_api',
              sourceId: 'a',
              sourceUrl: 'https://a.example/1',
              observedAt: '2026-09-06T00:00:00.000Z',
            },
            {
              sourceType: 'rss',
              sourceId: 'b',
              sourceUrl: 'https://b.example/1',
              observedAt: '2026-09-06T00:00:00.000Z',
            },
          ],
        }),
      )!,
    );
    expect(html).toContain('RUB');
    expect(html).toContain('найдена на 2 площадках');
  });

  it('не печатает список навыков, когда их нет', () => {
    const html = renderVacancyDocument(buildVacancyDetail(cluster({ skills: [] }))!);
    expect(html).not.toContain('catalog-skills');
  });

  it('печатает ссылку назад на средней странице', () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      cluster({ id: `c${index}`, canonicalTitle: `Data Analyst ${index}` }),
    );
    const html = renderCatalogDocument(buildCatalogPage(many, 2));
    expect(html).toContain('rel="prev"');
    expect(html).toContain('href="/vacancies"');
    expect(html).toContain('<link rel="prev"');
  });

  it('печатает вилку в карточке списка', () => {
    const html = renderCatalogDocument(
      buildCatalogPage([cluster({ salary: { from: 100, to: 200, currency: 'EUR' } })], 1),
    );
    expect(html).toContain('EUR');
  });

  /**
   * Читатель пришёл по ссылке на вакансию и получил список — без слов это
   * выглядит как ошибка сайта. Страница обязана сказать, что произошло.
   */
  it('говорит словами, что вакансии больше нет, и не даёт индексировать этот адрес', () => {
    const html = renderGoneDocument(buildCatalogPage([cluster()], 1));
    expect(html).toContain('Этой вакансии больше нет');
    expect(html).toContain('noindex');
    expect(html).toContain('catalog-card');
  });

  /**
   * Без внутренних ссылок краулер доходит до списка только через карту сайта,
   * а читатель — никогда: сузить выборку было бы нечем (B209, срез 2b).
   */
  it('печатает фильтры группами, называя, по чему идёт сужение', () => {
    const html = renderCatalogDocument(buildCatalogPage([cluster()], 1), [
      {
        kind: 'places',
        title: 'Места',
        links: [{ path: '/vacancies/berlin', label: 'Berlin', count: 7 }],
      },
      {
        kind: 'roles',
        title: 'Роли',
        links: [
          {
            path: '/vacancies/remote/frontend-developer',
            label: 'Frontend Developer — удалённо',
            count: 12,
          },
        ],
      },
    ]);
    expect(html).toContain('href="/vacancies/remote/frontend-developer"');
    expect(html).toContain('href="/vacancies/berlin"');
    // Группа называет, по чему сужение: «Берлин» и «Frontend Developer —
    // удалённо» в одном плоском списке читателю ничего не объясняли.
    expect(html).toContain('Места');
    expect(html).toContain('Роли');
    expect(html).toContain('Сузить выборку');
  });

  it('не печатает пустой блок фильтров', () => {
    expect(renderCatalogDocument(buildCatalogPage([cluster()], 1))).not.toContain('Сузить выборку');
  });

  it('экранирует чужой текст в подписи фильтра', () => {
    const html = renderCatalogDocument(buildCatalogPage([cluster()], 1), [
      {
        kind: 'places',
        title: 'Места',
        links: [{ path: '/vacancies/berlin', label: '<script>alert(1)</script>', count: 3 }],
      },
    ]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('ведёт крошками от списка обратно в каталог, а на корне их не печатает', () => {
    const listing = renderCatalogDocument(
      buildListingPage(
        [cluster()],
        {
          place: 'moscow',
          placeLabel: 'Москва',
          path: '/vacancies/moscow',
          count: 3,
        },
        1,
      ),
    );
    expect(listing).toContain('catalog-breadcrumbs');
    expect(listing).toContain('<h1>Вакансии — Москва</h1>');
    expect(renderCatalogDocument(buildCatalogPage([cluster()], 1))).not.toContain(
      'catalog-breadcrumbs',
    );
  });

  it('рендерит динамический шаблон LinkedIn, когда передана UnifiedVacancy', () => {
    const rawVacancy: UnifiedVacancy = {
      id: 'ats-greenhouse:123',
      fingerprint: 'ats-greenhouse:123',
      title: 'Senior Distributed Systems Engineer',
      company: 'Databricks',
      location: 'Amsterdam, Netherlands',
      isRemote: true,
      employmentType: 'Full-time',
      experienceLevel: 'Senior',
      salary: { from: 140000, to: 180000, currency: 'EUR' },
      description: 'Join Databricks engineering team.',
      requiredSkills: ['Rust', 'Distributed Systems'],
      responsibilities: ['Build high-scale ingestion systems'],
      qualifications: ['5+ years distributed systems'],
      url: 'https://boards.greenhouse.io/databricks/jobs/123',
      provenance: {
        sourceType: 'json_api',
        sourceId: 'ats-databricks',
        sourceName: 'Greenhouse',
        sourceUrl: 'https://boards.greenhouse.io/databricks/jobs/123',
        observedAt: '2026-09-14T00:00:00.000Z',
      },
      publishedAt: '2026-09-13T00:00:00.000Z',
      status: 'active',
    };
    const detail = buildVacancyDetail(
      cluster({
        canonicalCompany: 'Databricks',
        canonicalTitle: 'Senior Distributed Systems Engineer',
      }),
      undefined,
      rawVacancy,
    )!;
    const html = renderVacancyDocument(detail);

    expect(html).toContain('# Senior Distributed Systems Engineer');
    expect(html).toContain('**Databricks** · Amsterdam, Netherlands · `Remote` · `Full-time`');
    expect(html).toContain('### Top Skills &amp; Match');
    expect(html).toContain('`[Rust]` `[Distributed Systems]`');
    expect(html).toContain('### About the Role');
    expect(html).toContain('### What You&#39;ll Do');
    expect(html).toContain('- Build high-scale ingestion systems');
    expect(html).toContain('### Basic Qualifications');
  });
});
