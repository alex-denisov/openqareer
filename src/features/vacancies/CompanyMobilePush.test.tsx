// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CandidateCompanyOpportunity,
  CandidateCompanyRecruiter,
} from '../../../shared/candidateCompany';
import type { CompanyPeopleState } from './CompanyConnectionCircles';
import { CompanyMobilePush, type CompanyMobilePushProps } from './CompanyMobilePush';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vacancy = {
  id: 'v1',
  title: 'Head of Platform',
  location: 'Москва, гибрид',
  sourceName: 'hh.ru',
  sourceDate: '2026-10-05T08:00:00.000Z',
  href: 'https://hh.ru/vacancy/1',
};

const company: CandidateCompanyOpportunity = {
  key: 'vector',
  name: 'Вектор Банк',
  location: 'Москва',
  industry: 'финансы',
  vacancyCount: 12,
  contactsCount: 2,
  contactsImportedAt: '2026-09-12T08:00:00.000Z',
  want: true,
  nextStep: null,
  hasRecruiter: false,
  recruiterSearchStatus: 'idle',
  sources: [{ name: 'hh.ru', observedAt: '2026-10-06T08:00:00.000Z' }],
  vacancies: [
    vacancy,
    { ...vacancy, id: 'v2' },
    { ...vacancy, id: 'v3' },
    { ...vacancy, id: 'v4' },
  ],
  recruiters: [],
};

const people: CompanyPeopleState = {
  people: [
    {
      id: 'p1',
      fullName: 'Мария Орлова',
      roleTitle: 'Рекрутер',
      circle: 1,
      relation: 'писала вам 28.09',
      source: 'ваша переписка в LinkedIn',
      action: 'Написать знакомому',
      vacancyId: 'v1',
    },
    {
      id: 'p2',
      fullName: 'Сергей Волков',
      roleTitle: 'Руководитель платежей',
      circle: 2,
      relation: 'через контакт Игоря Н.',
      source: 'общий контакт',
      action: 'Попросить представить',
      vacancyId: 'v1',
    },
  ],
  coldVacancyId: 'v1',
  importedAt: '2026-09-12T08:00:00.000Z',
  importedCount: 412,
  loading: false,
  error: null,
  retry: () => undefined,
};

const recruiter: CandidateCompanyRecruiter = {
  id: 'r1',
  companyKey: 'vector',
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

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(overrides: Partial<CompanyMobilePushProps> = {}) {
  const props: CompanyMobilePushProps = {
    company,
    detail: null,
    people,
    linkedin: {
      status: 'connected',
      importedAt: '2026-09-12T08:00:00.000Z',
      contactsImported: true,
    },
    searchConsentGranted: true,
    busyWant: false,
    busySearch: false,
    actionError: null,
    onBack: vi.fn(),
    onToggleWant: vi.fn(),
    onSearch: vi.fn(),
    onAllowAndSearch: vi.fn(),
    onOpenLetter: vi.fn(),
    onOpenCompanyVacancies: vi.fn(),
    onOpenConnections: vi.fn(),
    ...overrides,
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<CompanyMobilePush {...props} />));
  return props;
}

function button(name: string | RegExp): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((item) =>
    typeof name === 'string' ? item.textContent?.includes(name) : name.test(item.textContent ?? ''),
  );
  if (!found) throw new Error(`no button ${String(name)}`);
  return found;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe('CompanyMobilePush (mockup 13, 390 mv=main|none|found|noli)', () => {
  it('is a push screen «Компания» with three vacancies, the whole list link and people rows', () => {
    const props = render();
    expect(document.querySelector('[role="dialog"] h1')?.textContent).toBe('Компания');
    expect(document.querySelector('.vacancy-push-hero h2')?.textContent).toBe('Вектор Банк');
    expect(document.body.textContent).toContain('Вакансии · 12');
    expect(document.querySelectorAll('[data-company-vacancy]')).toHaveLength(3);
    act(() => button('Все 12 вакансий компании').click());
    expect(props.onOpenCompanyVacancies).toHaveBeenCalledWith('Вектор Банк');
    expect(button('Мария Орлова').textContent).toContain('Круг 1');
    act(() => button('Сергей Волков').click());
    expect(props.onOpenLetter).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }), 2);
  });

  it('has one primary action: write to the first circle-1 person', () => {
    const props = render();
    const primary = document.querySelectorAll('.vacancy-push-primary');
    expect(primary).toHaveLength(1);
    expect(primary[0]!.textContent).toContain('Написать Марии Орловой');
    act(() => (primary[0] as HTMLButtonElement).click());
    expect(props.onOpenLetter).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }), 1);
  });

  it('wanted company shows «Убрать» in the want row; unwanted shows the want button', () => {
    const wanted = render();
    act(() => button('Убрать').click());
    expect(wanted.onToggleWant).toHaveBeenCalled();
    act(() => root?.unmount());
    host?.remove();
    const other = render({ company: { ...company, want: false } });
    act(() => button('Хочу в эту компанию').click());
    expect(other.onToggleWant).toHaveBeenCalled();
  });

  it('no contacts: honest import note and «Найти рекрутера»', () => {
    const props = render({ people: { ...people, people: [] } });
    expect(document.body.textContent).toContain('из 412 импортированных');
    act(() => button('Найти рекрутера').click());
    expect(props.onSearch).toHaveBeenCalled();
  });

  it('recruiter found: rows with circle 3 and a cold response to the first one', () => {
    const props = render({
      people: { ...people, people: [] },
      company: { ...company, recruiters: [recruiter], hasRecruiter: true },
    });
    expect(document.body.textContent).toContain('Вероятные рекрутеры');
    expect(button('Елена Миронова').textContent).toContain('Круг 3');
    act(() => button('Холодный отклик Елене Мироновой').click());
    expect(props.onOpenLetter).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }), 3);
  });

  it('without LinkedIn: «Написать рекрутеру» row and «Подключить LinkedIn»', () => {
    const props = render({
      people: { ...people, people: [] },
      linkedin: { status: 'disconnected', importedAt: null, contactsImported: false },
      company: { ...company, recruiters: [{ ...recruiter, source: 'vacancy' }] },
    });
    expect(document.body.textContent).toContain('LinkedIn не подключён');
    expect(button('Написать рекрутеру').textContent).toContain('Елена Миронова');
    act(() => button('Подключить LinkedIn').click());
    expect(props.onOpenConnections).toHaveBeenCalled();
  });

  it('back closes the push screen', () => {
    const props = render();
    act(() => (document.querySelector('[aria-label="Назад"]') as HTMLButtonElement).click());
    expect(props.onBack).toHaveBeenCalled();
  });
});
