// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CandidateCompanyOpportunity,
  CandidateCompanyRecruiter,
} from '../../../shared/candidateCompany';
import { CompanyPeopleSection, type CompanyPeopleSectionProps } from './CompaniesAndPeoplePeople';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const recruiter: CandidateCompanyRecruiter = {
  id: 'r1',
  companyKey: 'grinkod',
  vacancyId: 'v1',
  fullName: 'Елена Миронова',
  roleTitle: 'Talent Acquisition Lead',
  email: null,
  emailStatus: 'unverified',
  phone: null,
  telegram: null,
  whatsapp: null,
  linkedinUrl: null,
  githubUrl: null,
  twitterUrl: null,
  source: 'public-profile',
  sourceLabel: 'публичный профиль LinkedIn',
  sourceDate: '2026-10-08T08:00:00.000Z',
  isHypothesis: true,
};

// The recruiter-search response as the API returns it once the search job is done (state «рекрутер найден»).
const company: CandidateCompanyOpportunity = {
  key: 'grinkod',
  name: 'Гринкод',
  location: 'Москва',
  industry: 'разработка',
  vacancyCount: 3,
  contactsCount: 0,
  contactsImportedAt: '2026-09-12T08:00:00.000Z',
  want: false,
  nextStep: null,
  hasRecruiter: true,
  recruiterSearchStatus: 'ready',
  sources: [{ name: 'LinkedIn', observedAt: '2026-10-06T08:00:00.000Z' }],
  vacancies: [
    {
      id: 'v1',
      title: 'Director of Engineering',
      location: 'Москва, офис',
      sourceName: 'LinkedIn',
      sourceDate: '2026-10-06T08:00:00.000Z',
      href: '',
    },
  ],
  recruiters: [
    recruiter,
    { ...recruiter, id: 'r2', fullName: 'Илья Громов', roleTitle: 'HR Business Partner' },
  ],
};

let root: Root | null = null;

function render(overrides: Partial<CompanyPeopleSectionProps> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const props: CompanyPeopleSectionProps = {
    company,
    people: {
      people: [],
      coldVacancyId: 'v1',
      importedAt: '2026-09-12T08:00:00.000Z',
      importedCount: 412,
      loading: false,
      error: null,
      retry: () => undefined,
    },
    linkedin: {
      status: 'connected',
      importedAt: '2026-09-12T08:00:00.000Z',
      contactsImported: true,
    },
    consentGranted: true,
    consentRequired: false,
    busySearch: false,
    searchError: null,
    onSearch: vi.fn(),
    onAllowAndSearch: vi.fn(),
    onOpenLetter: vi.fn(),
    onWriteRecruiter: vi.fn(),
    ...overrides,
  };
  act(() => root!.render(<CompanyPeopleSection {...props} />));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('CompanyPeopleSection, recruiter found (mockup 13 view=found)', () => {
  it('says how many probable recruiters were found and where', () => {
    const host = render();
    expect(host.textContent).toContain(
      'Найдено 2 вероятных рекрутера по публичным профилям LinkedIn. Это предположение по должности и компании, не подтверждение: проверьте профиль перед письмом.',
    );
  });

  it('shows each one as a person card with circle 3 and a cold response', () => {
    const host = render();
    const cards = host.querySelectorAll('.companies-people-person');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Елена Миронова');
    expect(cards[0].textContent).toContain('Должность в профиле: Talent Acquisition Lead, Гринкод');
    expect(cards[0].textContent).toContain('публичный профиль LinkedIn, 08.10.2026');
    expect(cards[0].textContent).toContain('Круг 3');
    expect(cards[0].textContent).toContain('Холодный отклик');
  });
});
