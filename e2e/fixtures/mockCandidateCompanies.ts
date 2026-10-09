import type { Page } from '@playwright/test';
import type {
  CandidateCompanyDetails,
  CandidateCompanyOpportunity,
  CandidateCompanyPage,
} from '../../../shared/candidateCompany';

const wantedSteps = new Map<string, { text: string; dueAt: string | null }>();
let searchConsentGranted = false;
type MutableCompany = {
  -readonly [Key in keyof CandidateCompanyOpportunity]: CandidateCompanyOpportunity[Key];
};
let companies: MutableCompany[] = createCompanyFixtures();

function createCompanyFixtures(): MutableCompany[] {
  return Array.from({ length: 400 }, (_, index) => companyFixture(index));
}

function recruiterFixture(
  companyKey: string,
  fullName: string,
  roleTitle: string,
  source: 'vacancy' | 'public-profile',
  sourceLabel: string,
  isHypothesis: boolean,
): CandidateCompanyOpportunity['recruiters'][number] {
  return {
    id: `${companyKey}-recruiter-${fullName.toLowerCase().replaceAll(' ', '-')}`,
    companyKey,
    vacancyId: `${companyKey}-vacancy-1`,
    fullName,
    roleTitle,
    email: null,
    emailStatus: 'unverified',
    phone: null,
    telegram: null,
    whatsapp: null,
    linkedinUrl: `https://www.linkedin.com/in/${fullName.toLowerCase().replaceAll(' ', '-')}`,
    githubUrl: null,
    twitterUrl: null,
    source,
    sourceLabel,
    sourceDate: '2026-10-08T10:00:00.000Z',
    isHypothesis,
  };
}

function companyFixture(index: number): MutableCompany {
  const seed = companySeed(index);
  const key = `synthetic-company-${index}`;
  const recruiters = seed.recruiterName
    ? [
        recruiterFixture(
          key,
          seed.recruiterName,
          'Рекрутер',
          'vacancy',
          'Объявление вакансии',
          false,
        ),
      ]
    : [];
  const vacancies = Array.from({ length: Math.min(seed.vacancyCount, 3) }, (_, item) => ({
    id: `${key}-vacancy-${item + 1}`,
    title: item === 0 ? 'Head of Platform' : `Руководитель направления ${item + 1}`,
    location: seed.location,
    sourceName: item % 2 === 0 ? 'hh.ru' : 'LinkedIn',
    sourceDate: '2026-10-08T10:00:00.000Z',
    href: `https://example.test/${key}/${item + 1}`,
  }));
  return {
    key,
    name: seed.name,
    location: seed.location,
    industry: seed.industry,
    vacancyCount: seed.vacancyCount,
    contactsCount: null,
    contactsImportedAt: null,
    want: seed.want,
    nextStep: wantedSteps.get(key) ?? null,
    hasRecruiter: recruiters.length > 0,
    recruiterSearchStatus: recruiters.length > 0 ? 'ready' : 'idle',
    sources: [{ name: 'hh.ru', observedAt: '2026-10-08T10:00:00.000Z' }],
    vacancies,
    recruiters,
  };
}

function companySeed(index: number) {
  const seeds = [
    {
      name: 'Вектор Банк',
      vacancyCount: 12,
      want: true,
      location: 'Москва',
      industry: 'Финансы',
      recruiterName: 'Мария Орлова',
    },
    {
      name: 'Арка Холдинг',
      vacancyCount: 9,
      want: true,
      location: 'Удалённо РФ',
      industry: 'Финансы',
      recruiterName: 'Анна Седова',
    },
    {
      name: 'Маркет Софт',
      vacancyCount: 7,
      want: true,
      location: 'Москва',
      industry: 'Разработка',
      recruiterName: '',
    },
    {
      name: 'СберТех Лаб',
      vacancyCount: 11,
      want: false,
      location: 'Москва',
      industry: 'Разработка',
      recruiterName: '',
    },
    {
      name: 'Контур Плюс',
      vacancyCount: 8,
      want: false,
      location: 'Екатеринбург',
      industry: 'Разработка',
      recruiterName: '',
    },
    {
      name: 'Логикон',
      vacancyCount: 6,
      want: false,
      location: 'Москва',
      industry: 'Логистика',
      recruiterName: '',
    },
    {
      name: 'Тандем Софт',
      vacancyCount: 5,
      want: false,
      location: 'Москва',
      industry: 'Разработка',
      recruiterName: '',
    },
    {
      name: 'Финтех Про',
      vacancyCount: 5,
      want: false,
      location: 'Санкт-Петербург',
      industry: 'Финансы',
      recruiterName: '',
    },
    {
      name: 'Пэйсервис',
      vacancyCount: 4,
      want: false,
      location: 'Москва',
      industry: 'Финансы',
      recruiterName: '',
    },
    {
      name: 'Облако+',
      vacancyCount: 3,
      want: false,
      location: 'Москва',
      industry: 'Разработка',
      recruiterName: '',
    },
    {
      name: 'Гринкод',
      vacancyCount: 3,
      want: false,
      location: 'Москва',
      industry: 'Разработка',
      recruiterName: '',
    },
  ];
  return (
    seeds[index] ?? {
      name: `Тестовая компания ${String(index + 1).padStart(3, '0')}`,
      vacancyCount: (index % 12) + 1,
      want: false,
      location: 'Москва',
      industry: 'Не указано',
      recruiterName: '',
    }
  );
}

function sortedCompanies(sort: string): CandidateCompanyOpportunity[] {
  const rows = companies.map((company) => ({
    ...company,
    want: wantedSteps.has(company.key) || company.want,
    nextStep: wantedSteps.get(company.key) ?? company.nextStep,
  }));
  if (sort === 'alphabetical') return rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  if (sort === 'contacts') return rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return rows.sort(
    (a, b) =>
      Number(b.want) - Number(a.want) ||
      b.vacancyCount - a.vacancyCount ||
      a.name.localeCompare(b.name, 'ru'),
  );
}

function filteredCompanies(searchParams: URLSearchParams): CandidateCompanyOpportunity[] {
  const filter = searchParams.get('filter') ?? 'all';
  const search = (searchParams.get('search') ?? '').toLocaleLowerCase('ru-RU');
  return sortedCompanies(searchParams.get('sort') ?? 'default').filter((company) => {
    if (filter === 'want' && !company.want) return false;
    if (filter === 'recruiter' && !company.hasRecruiter) return false;
    if (filter === 'contacts') return false;
    return !search || company.name.toLocaleLowerCase('ru-RU').includes(search);
  });
}

function pageFor(url: URL): CandidateCompanyPage {
  const rows = filteredCompanies(url.searchParams);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Math.min(20, Number(url.searchParams.get('limit') ?? 20));
  return {
    items: rows.slice(offset, offset + limit),
    total: rows.length,
    offset,
    limit,
    sort: (url.searchParams.get('sort') as CandidateCompanyPage['sort']) ?? 'default',
    filter: (url.searchParams.get('filter') as CandidateCompanyPage['filter']) ?? 'all',
    filterCounts: {
      all: companies.length,
      want: companies.filter((company) => company.want || wantedSteps.has(company.key)).length,
      contacts: null,
      recruiter: companies.filter((company) => company.hasRecruiter).length,
    },
    linkedin: { status: 'disconnected', importedAt: null, contactsImported: false },
    searchConsentGranted,
  };
}

function detailsFor(company: CandidateCompanyOpportunity, offset: number): CandidateCompanyDetails {
  const allVacancies = Array.from({ length: company.vacancyCount }, (_, index) => ({
    id: `${company.key}-vacancy-${index + 1}`,
    title: index === 0 ? 'Head of Platform' : `Руководитель направления ${index + 1}`,
    location: company.location,
    sourceName: index % 2 === 0 ? 'hh.ru' : 'LinkedIn',
    sourceDate: '2026-10-08T10:00:00.000Z',
    href: `https://example.test/${company.key}/${index + 1}`,
  }));
  const vacancies = allVacancies.slice(offset, offset + 20);
  return {
    company,
    vacancies,
    totalVacancies: allVacancies.length,
    vacancyOffset: offset,
    nextOffset: offset + vacancies.length < allVacancies.length ? offset + vacancies.length : null,
  };
}

export async function mockCandidateCompanies(page: Page): Promise<void> {
  searchConsentGranted = false;
  wantedSteps.clear();
  companies = createCompanyFixtures();
  await page.route('**/api/v1/candidate/companies**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/v1/candidate/companies' && route.request().method() === 'GET') {
      return route.fulfill({ json: { data: pageFor(url) } });
    }
    const detail = path.match(/^\/api\/v1\/candidate\/companies\/([^/]+)$/u);
    if (detail && route.request().method() === 'GET') {
      const company = sortedCompanies('default').find((item) => item.key === detail[1]);
      if (!company) return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
      return route.fulfill({
        json: { data: detailsFor(company, Number(url.searchParams.get('vacancyOffset') ?? 0)) },
      });
    }
    const mutation = path.match(
      /^\/api\/v1\/candidate\/companies\/([^/]+)\/(want|next-step|recruiter-search)$/u,
    );
    if (!mutation) return route.fallback();
    const company = companies.find((item) => item.key === mutation[1]);
    if (!company) return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
    if (mutation[2] === 'want') {
      if (route.request().method() === 'DELETE') {
        company.want = false;
        wantedSteps.delete(company.key);
      } else {
        company.want = true;
      }
      return route.fulfill({ json: { data: { want: route.request().method() !== 'DELETE' } } });
    }
    if (mutation[2] === 'next-step') {
      const body = route.request().postDataJSON() as { text: string; dueAt: string | null };
      wantedSteps.set(company.key, body);
      company.want = true;
      return route.fulfill({ json: { data: { nextStep: body } } });
    }
    if (!searchConsentGranted) {
      return route.fulfill({
        status: 403,
        json: {
          error: { code: 'search_consent_required', message: 'Нужно согласие «Вы в поиске».' },
        },
      });
    }
    company.recruiterSearchStatus = 'queued';
    return route.fulfill({ status: 202, json: { data: { searchStatus: 'queued' } } });
  });
  await page.route('**/api/v1/candidate/search-consent', async (route) => {
    if (route.request().method() === 'PUT') {
      searchConsentGranted = (route.request().postDataJSON() as { granted: boolean }).granted;
    }
    return route.fulfill({
      json: {
        data: {
          consent: { granted: searchConsentGranted, policyVersion: 'synthetic', updatedAt: '' },
        },
      },
    });
  });
}
