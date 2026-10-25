import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCatalogPage,
  buildListingPage,
  buildVacancyDetail,
  CATALOG_PAGE_SIZE,
  closeDanglingParentheses,
  googleEmploymentType,
  readableSkill,
} from './vacancyCatalogPage';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';

function cluster(overrides: Partial<VacancyCluster> = {}): VacancyCluster {
  return {
    id: 'board-1:cluster-1',
    canonicalTitle: 'Director, Privacy Legal',
    canonicalCompany: 'Reddit',
    canonicalLocation: 'San Francisco, USA',
    isRemote: false,
    descriptionSummary:
      'Мы ищем директора по правовым вопросам приватности. Он отвечает за политику данных, проверки и обучение команд.',
    skills: ['Privacy', 'GDPR'],
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
    // A salary keeps the default card in the indexable set (seo/catalogIndexing).
    salary: { from: 200000, to: 300000, currency: 'RUB' },
    ...overrides,
  };
}

/** The fixture's dates are fresh at this moment: posted 5 days ago, seen today. */
const NOW = new Date('2026-09-06T12:00:00.000Z');

describe('страница публичного каталога вакансий (B209)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('оставляет только вакансии, которым правило адресов даёт адрес', () => {
    const page = buildCatalogPage(
      [
        cluster(),
        cluster({ id: 'c2', canonicalTitle: 'Специалист по щебню', canonicalCompany: 'Карьер' }),
      ],
      1,
    );

    expect(page.total).toBe(1);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].path).toMatch(/^\/vacancies\/job\/director-privacy-legal-at-reddit-/u);
  });

  it('считает страницы по всему отобранному каталогу, а не по одной странице', () => {
    const many = Array.from({ length: CATALOG_PAGE_SIZE * 2 + 3 }, (_, index) =>
      cluster({ id: `c${index}`, canonicalTitle: `Data Analyst ${index}` }),
    );
    const page = buildCatalogPage(many, 2);

    expect(page.total).toBe(CATALOG_PAGE_SIZE * 2 + 3);
    expect(page.pageCount).toBe(3);
    expect(page.page).toBe(2);
    expect(page.entries).toHaveLength(CATALOG_PAGE_SIZE);
    expect(page.canonicalPath).toBe('/vacancies/page/2');
  });

  it('сводит страницу за пределами каталога к последней, а не к пустоте', () => {
    const page = buildCatalogPage([cluster()], 99);
    expect(page.page).toBe(1);
    expect(page.entries).toHaveLength(1);
  });

  it('печатает список как ItemList с хлебными крошками', () => {
    const page = buildCatalogPage([cluster()], 1);
    const types = page.jsonLd['@graph'].map((node) => node['@type']);
    expect(types).toContain('ItemList');
    expect(types).toContain('BreadcrumbList');
  });

  it('строит JobPosting со всеми полями, которые действительно известны', () => {
    const detail = buildVacancyDetail(cluster())!;
    const posting = detail.jsonLd['@graph'].find((node) => node['@type'] === 'JobPosting')!;

    expect(posting).toMatchObject({
      title: 'Director, Privacy Legal',
      datePosted: '2026-09-01',
      hiringOrganization: { '@type': 'Organization', name: 'Reddit' },
      directApply: false,
    });
    expect(posting.description).toContain('директора');
    expect(posting.identifier).toMatchObject({ '@type': 'PropertyValue' });
  });

  /**
   * Кластер несёт только первые 300 знаков описания, и в разметку уходил
   * обрывок на полуслове. Поисковик требует, чтобы разметка совпадала с тем,
   * что видит читатель, поэтому полный текст идёт и в `JobPosting`, и на
   * страницу — одним и тем же значением.
   */
  it('берёт полный текст вакансии, когда он известен', () => {
    const full = 'Полное описание вакансии. '.repeat(30);
    const detail = buildVacancyDetail(cluster(), full)!;
    const posting = detail.jsonLd['@graph'].find((node) => node['@type'] === 'JobPosting')!;

    expect(detail.description).toBe(full.trim());
    expect(posting.description).toBe(`<p>${full.trim()}</p>`);
    expect(String(posting.description).length).toBeGreaterThan(300);
  });

  it('довольствуется сводкой, когда полного текста нет', () => {
    const detail = buildVacancyDetail(cluster())!;
    expect(detail.description).toBe(cluster().descriptionSummary);
    expect(buildVacancyDetail(cluster(), '   ')!.description).toBe(cluster().descriptionSummary);
  });

  it('не выдумывает поля, которых площадка не назвала', () => {
    const detail = buildVacancyDetail(cluster({ canonicalLocation: undefined }))!;
    const posting = detail.jsonLd['@graph'].find((node) => node['@type'] === 'JobPosting')!;

    expect(posting).not.toHaveProperty('jobLocation');
    // Язык текста вакансии задаёт работодатель, и мы его не знаем.
    expect(posting).not.toHaveProperty('inLanguage');
    // validThrough — наш срок, а не поле площадки: публикация + 30 дней.
    expect(posting.validThrough).toBe('2026-10-01T00:00:00.000Z');
  });

  it('не размечает JobPosting карточку без вилки или без работодателя', () => {
    for (const overrides of [{ salary: undefined }, { canonicalCompany: '' }]) {
      const detail = buildVacancyDetail(cluster(overrides))!;
      expect(detail.indexable).toBe(false);
      expect(detail.jsonLd['@graph'].map((node) => node['@type'])).toEqual(['BreadcrumbList']);
    }
  });

  it('не размечает JobPosting карточку старше окна публикации', () => {
    const detail = buildVacancyDetail(cluster(), undefined, undefined, new Date('2026-10-01'))!;
    expect(detail.indexable).toBe(false);
  });

  it('не размечает JobPosting карточку, у которой площадка не передала текст', () => {
    for (const descriptionSummary of ['', 'Бухгалтер']) {
      const detail = buildVacancyDetail(cluster({ descriptionSummary }))!;
      expect(detail.indexable).toBe(false);
      expect(detail.jsonLd['@graph'].map((node) => node['@type'])).toEqual(['BreadcrumbList']);
    }
  });

  it('переводит вид занятости площадки в employmentType Google и не угадывает остальное', () => {
    expect(googleEmploymentType('FULL')).toBe('FULL_TIME');
    expect(googleEmploymentType('Part-time')).toBe('PART_TIME');
    expect(googleEmploymentType('PROJECT')).toBe('CONTRACTOR');
    expect(googleEmploymentType('Internship')).toBe('INTERN');
    expect(googleEmploymentType('Hybrid')).toBeUndefined();
    expect(googleEmploymentType(undefined)).toBeUndefined();
  });

  it('берёт validThrough из даты снятия, когда площадка её назвала', () => {
    const vacancy: UnifiedVacancy = {
      id: 'v1',
      fingerprint: 'f1',
      title: 'Director, Privacy Legal',
      company: 'Reddit',
      location: 'San Francisco, USA',
      isRemote: false,
      description: 'Мы ищем директора.',
      requiredSkills: [],
      url: 'https://boards.greenhouse.io/reddit/jobs/1',
      provenance: {
        sourceType: 'json_api',
        sourceId: 'ats-reddit',
        sourceUrl: 'https://boards.greenhouse.io/reddit/jobs/1',
        observedAt: '2026-09-06T00:00:00.000Z',
      },
      publishedAt: '2026-09-01T00:00:00.000Z',
      status: 'active',
      archivedAt: '2026-09-20T00:00:00.000Z',
      employmentType: 'FULL',
    };
    const detail = buildVacancyDetail(cluster(), undefined, vacancy)!;
    const posting = detail.jsonLd['@graph'].find((node) => node['@type'] === 'JobPosting');
    expect(posting?.validThrough).toBe('2026-09-20T00:00:00.000Z');
    expect(posting?.employmentType).toBe('FULL_TIME');
  });

  it('называет удалённую вакансию удалённой так, как это понимает поисковик', () => {
    const detail = buildVacancyDetail(cluster({ isRemote: true, canonicalLocation: undefined }))!;
    const posting = detail.jsonLd['@graph'].find((node) => node['@type'] === 'JobPosting')!;
    expect(posting.jobLocationType).toBe('TELECOMMUTE');
  });

  it('отказывает вакансии без адреса', () => {
    expect(buildVacancyDetail(cluster({ canonicalTitle: 'Специалист по щебню' }))).toBeNull();
  });

  it.each([
    { from: 65, to: 90, currency: 'USD' },
    { from: 70000, to: 115000, currency: 'USD' },
    { from: 200000, to: 300000, currency: 'RUB' },
  ])('не угадывает период оплаты по величине или валюте: %j', (salary) => {
    const detail = buildVacancyDetail(
      cluster({ salary }),
      'Compensation: $65–$90 per hour based upon experience. '.repeat(10),
    )!;
    const posting = detail.jsonLd['@graph'].find((node) => node['@type'] === 'JobPosting')!;
    expect(posting).not.toHaveProperty('baseSalary');
    expect(detail.entry.salaryLabel).toContain(salary.from.toLocaleString('ru-RU'));
    expect(detail.entry.salaryLabel).toContain(salary.to.toLocaleString('ru-RU'));
    expect(detail.description).toContain('per hour');
  });

  it.each(['United States', 'USA', 'US', 'Россия', 'Germany'])(
    'не выдаёт страну %s за город удалённой вакансии',
    (canonicalLocation) => {
      const detail = buildVacancyDetail(cluster({ canonicalLocation, isRemote: true }))!;
      const posting = detail.jsonLd['@graph'].find((node) => node['@type'] === 'JobPosting')!;
      expect(posting).not.toHaveProperty('jobLocation');
      expect(posting.jobLocationType).toBe('TELECOMMUTE');
      expect(posting.applicantLocationRequirements).toMatchObject({ '@type': 'Country' });
    },
  );

  it('сохраняет реальный город и страну гибридной вакансии', () => {
    const detail = buildVacancyDetail(
      cluster({ canonicalLocation: 'Berlin, Germany', isRemote: true }),
    )!;
    const posting = detail.jsonLd['@graph'].find((node) => node['@type'] === 'JobPosting')!;
    expect(posting.jobLocation).toMatchObject({
      address: { addressLocality: 'Berlin, Germany', addressCountry: 'DE' },
    });
    expect(posting.applicantLocationRequirements).toEqual({ '@type': 'Country', name: 'DE' });
  });

  it('печатает одностороннюю вилку словами «от» и «до»', () => {
    const from = buildVacancyDetail(cluster({ salary: { from: 150000, currency: 'RUB' } }))!;
    const to = buildVacancyDetail(cluster({ salary: { to: 90000 } }))!;
    // `toLocaleString('ru-RU')` разделяет разряды неразрывным пробелом —
    // сравниваем с тем же форматированием, а не с набранным руками.
    expect(from.entry.salaryLabel).toBe(`от ${(150000).toLocaleString('ru-RU')} ₽`);
    expect(to.entry.salaryLabel).toBe(`до ${(90000).toLocaleString('ru-RU')}`);
  });

  it('не выдаёт вилкой пустой объект оплаты', () => {
    const detail = buildVacancyDetail(cluster({ salary: { gross: true } }))!;
    expect(detail.entry.salaryLabel).toBeUndefined();
  });

  it('сохраняет одностороннюю вилку в карточке без неподтверждённого baseSalary', () => {
    const detail = buildVacancyDetail(cluster({ salary: { from: 150000 } }))!;
    const posting = detail.jsonLd['@graph'].find((node) => node['@type'] === 'JobPosting')!;
    expect(detail.entry.salaryLabel).toBe(`от ${(150000).toLocaleString('ru-RU')}`);
    expect(posting).not.toHaveProperty('baseSalary');
  });

  it('пустой каталог — одна страница, а не ноль', () => {
    const page = buildCatalogPage([], 1);
    expect(page.pageCount).toBe(1);
    expect(page.total).toBe(0);
    expect(page.nextPath).toBeUndefined();
    expect(page.previousPath).toBeUndefined();
  });

  it('на последней странице нет ссылки вперёд, на первой — назад', () => {
    const many = Array.from({ length: CATALOG_PAGE_SIZE + 1 }, (_, index) =>
      cluster({ id: `c${index}`, canonicalTitle: `Data Analyst ${index}` }),
    );
    expect(buildCatalogPage(many, 1).previousPath).toBeUndefined();
    expect(buildCatalogPage(many, 2).nextPath).toBeUndefined();
    expect(buildCatalogPage(many, 2).previousPath).toBe('/vacancies');
  });

  it('не печатает навыки в разметке, когда площадка их не назвала', () => {
    const detail = buildVacancyDetail(cluster({ skills: [] }))!;
    const posting = detail.jsonLd['@graph'].find((node) => node['@type'] === 'JobPosting')!;
    expect(posting).not.toHaveProperty('skills');
  });
});

/**
 * Срез 2b: страница списка по месту и роли. Именно по таким запросам ищут, и
 * заголовок страницы обязан называть и место, и роль.
 */
describe('страница списка каталога (B209, срез 2b)', () => {
  const summary = {
    place: 'moscow',
    placeLabel: 'Москва',
    role: 'frontend-developer',
    roleLabel: 'Frontend Developer',
    path: '/vacancies/moscow/frontend-developer',
    count: 4,
  };

  it('называет место и роль в заголовке и в каноническом адресе', () => {
    const page = buildListingPage([cluster()], summary, 1);
    expect(page.heading).toBe('Frontend Developer — вакансии, Москва');
    expect(page.canonicalPath).toBe('/vacancies/moscow/frontend-developer');
    expect(page.documentTitle).toContain('Frontend Developer');
    expect(page.documentTitle).toContain('Москва');
  });

  it('называет список по одному месту без роли', () => {
    const page = buildListingPage(
      [cluster()],
      { ...summary, role: undefined, roleLabel: undefined, path: '/vacancies/moscow' },
      1,
    );
    expect(page.heading).toBe('Вакансии — Москва');
    expect(page.description.length).toBeGreaterThanOrEqual(120);
    expect(page.description.length).toBeLessThanOrEqual(160);
  });

  it('нумерует страницы списка адресами самого списка', () => {
    const many = Array.from({ length: CATALOG_PAGE_SIZE + 2 }, (_, index) =>
      cluster({ id: `c${index}`, canonicalTitle: `Frontend Developer ${index}` }),
    );
    const page = buildListingPage(many, summary, 2);
    expect(page.canonicalPath).toBe('/vacancies/moscow/frontend-developer/page/2');
    expect(page.previousPath).toBe('/vacancies/moscow/frontend-developer');
    expect(page.nextPath).toBeUndefined();
  });

  it('ведёт хлебные крошки через каталог к самому списку', () => {
    const page = buildListingPage([cluster()], summary, 1);
    const crumbs = page.jsonLd['@graph'].find((node) => node['@type'] === 'BreadcrumbList');
    expect(JSON.stringify(crumbs)).toContain('/vacancies/moscow/frontend-developer');
  });
});

describe('видимая зарплата каталога', () => {
  it('печатает одно число, когда концы вилки равны, и знак вместо кода валюты', () => {
    const detail = buildVacancyDetail(
      cluster({ salary: { from: 125000, to: 125000, currency: 'RUR' } }),
    )!;
    expect(detail.entry.salaryLabel).toBe(`${(125000).toLocaleString('ru-RU')} ₽`);
  });
});

describe('страна в разметке вакансии', () => {
  it('называет страну и требование к кандидату у удалённой вакансии', () => {
    const detail = buildVacancyDetail(
      cluster({ canonicalLocation: 'Berlin, Germany', isRemote: true }),
      undefined,
      undefined,
      NOW,
    )!;
    expect(detail.indexable).toBe(true);
    const posting = JSON.stringify(detail.jsonLd);
    expect(posting).toContain('"addressCountry":"DE"');
    expect(posting).toContain('"applicantLocationRequirements":{"@type":"Country","name":"DE"}');
  });
});

describe('чистые названия и навыки в разметке (B535, круг 5)', () => {
  it('закрывает скобку, обрезанную площадкой, в title, h1 и разметке', () => {
    expect(closeDanglingParentheses('Consultant - Water (Chemical')).toBe(
      'Consultant - Water (Chemical)',
    );
    expect(closeDanglingParentheses('Developer (Backend)')).toBe('Developer (Backend)');
    const detail = buildVacancyDetail(
      cluster({ canonicalTitle: 'Consultant (Chemical' }),
      undefined,
      undefined,
      NOW,
    )!;
    expect(JSON.stringify(detail.jsonLd)).toContain('"title":"Consultant (Chemical)"');
  });

  it('печатает навыки словами, а не слагами', () => {
    expect(readableSkill('Senior-Backend-Engineer')).toBe('Senior Backend Engineer');
    expect(readableSkill('Front-end')).toBe('Front-end');
    const detail = buildVacancyDetail(
      cluster({ skills: ['Digital-Sales-Director', 'GDPR'] }),
      undefined,
      undefined,
      NOW,
    )!;
    expect(JSON.stringify(detail.jsonLd)).toContain('"skills":"Digital Sales Director, GDPR"');
  });
});
