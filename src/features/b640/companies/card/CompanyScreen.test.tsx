// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { B640CompanyItem, B640CompanyPerson } from '../../../../../shared/b640Companies';
import { CoachApiError } from '../../../coach/apiClient';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { click, mount } from '../../kit/testDom';
import type { CompanyCard } from '../companiesApi';
import { CompanyScreen } from './CompanyScreen';

vi.mock('../../shell/ShellContext', () => ({
  useShell: () => ({ navigate: () => undefined }),
  useScreenChrome: () => undefined,
}));
vi.mock('../companiesApi', () => ({ getB640Company: vi.fn(), getB640CompanyPeople: vi.fn() }));
vi.mock('../../../vacancies/candidateCompaniesApi', () => ({
  setCandidateCompanyWant: vi.fn(async () => undefined),
  removeCandidateCompanyWant: vi.fn(async () => undefined),
}));

// Ширина экрана для `useIsMobile`: в jsdom своего matchMedia нет.
let mobile = false;
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: mobile,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
}));

const api = { ...(await import('../companiesApi')), ...(await import('../../../vacancies/candidateCompaniesApi')) };
const KEY = 'c'.repeat(24);

function vacancy(id: string, title: string, percent?: number): MatchedVacancyItem {
  return {
    cluster: {
      id, canonicalTitle: title, canonicalCompany: 'Ладога Банк', canonicalLocation: 'Москва', isRemote: false, workFormat: 'hybrid',
      salary: { from: 480000, to: 580000, currency: 'RUR' }, skills: [], descriptionSummary: '', primaryUrl: '', sources: [],
      firstObservedAt: '2026-11-11T09:00:00.000Z', lastSeenAt: '2026-11-11T09:00:00.000Z', status: 'active', vacanciesCount: 1,
    },
    explanation: {
      clusterId: id, roleMatch: 'target', levelMatch: undefined, matchingPoints: [], missingPoints: [], summary: '', calculatedAt: '',
      ...(percent ? { fitView: { state: 'ready', result: { status: 'assessed', dataState: 'known', coveragePercent: percent, coverage: { total: 5 } } } } : {}),
    },
  } as unknown as MatchedVacancyItem;
}

const person = (patch: Partial<B640CompanyPerson>): B640CompanyPerson => ({
  id: 'p', circle: 3, name: 'Алина Громова', roleTitle: 'технический рекрутер', evidence: 'рекрутер вакансии на hh.ru, 11.11',
  nextStep: 'cold_application', vacancyId: 'cl-1', platformMember: false, message: null, ...patch,
});

function card(patch: Partial<B640CompanyItem> = {}, roles = [vacancy('cl-1', 'Руководитель разработки', 86)]): CompanyCard {
  const company = {
    key: KEY, name: 'Ладога Банк', location: 'Москва', industry: 'Банки', vacancyCount: 1, contactsCount: null, contactsImportedAt: null,
    want: false, nextStep: null, hasRecruiter: true, recruiterSearchStatus: 'ready', sources: [{ name: 'hh.ru', observedAt: '2026-11-10T09:00:00.000Z' }],
    vacancies: [], recruiters: [], relocation: null, ...patch,
  } as B640CompanyItem;
  return {
    company, roleVacancies: roles, roleTotal: roles.length, roleNextOffset: null,
    otherVacancies: [vacancy('cl-9', 'Аналитик данных')], otherTotal: 1, applications: {},
  };
}

const flush = () => act(async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });
afterEach(() => {
  vi.clearAllMocks();
  mobile = false;
});

function people(items: B640CompanyPerson[]) {
  vi.mocked(api.getB640CompanyPeople).mockResolvedValue({ items, total: items.length, offset: 0, nextOffset: null });
}

describe('v10b: карточка компании', () => {
  it('шапка, вакансия с процентом и деньгами, другие вакансии, люди по кругам', async () => {
    vi.mocked(api.getB640Company).mockResolvedValue(card());
    people([
      person({ id: 'a', circle: 1, name: 'Роман Ефимов', nextStep: 'write_known_contact' }),
      person({ id: 'b', circle: 2, name: null, roleTitle: null, platformMember: true, nextStep: 'ask_for_introduction' }),
      person({ id: 'c' }),
    ]);
    const view = mount(<CompanyScreen companyId={KEY} />);
    await flush();
    expect(view.container.querySelector('#co-name')!.textContent).toContain('Ладога Банк');
    expect(view.container.querySelector('.lead-text')!.textContent).toBe('Москва · Банки');
    const row = view.container.querySelector('.co-vrow')!;
    expect(row.querySelector('div.row-title')!.textContent).toBe('Руководитель разработки');
    expect(row.querySelector('.row-sub')!.textContent).toMatch(/480.*580.*гибрид · 11\.11/u);
    expect(row.querySelector('.vt-fit')!.textContent).toContain('86');
    expect(view.container.querySelector('.more-n summary')!.textContent).toBe('Другие вакансии компании · 1');
    const rows = [...view.container.querySelectorAll('.co-person')];
    expect(rows.map((item) => item.querySelector('.tag')!.textContent)).toEqual(['круг 1', 'круг 2', 'круг 3']);
    expect(rows[0]!.querySelector('.btn')!.textContent).toBe('Написать знакомому');
    expect(rows[1]!.querySelector('.row-title')!.textContent).toBe('Участник платформы');
    expect(rows[1]!.querySelector('.btn')!.textContent).toBe('Попросить представить');
    expect(rows[2]!.querySelector('.btn')!.textContent).toBe('Холодный отклик');
    view.unmount();
  });

  it('B645: на 390 действия шапки — в закреплённой панели над навигацией', async () => {
    mobile = true;
    vi.mocked(api.getB640Company).mockResolvedValue(card());
    people([person({ id: 'a', circle: 1, name: 'Роман Ефимов', nextStep: 'write_known_contact' })]);
    const view = mount(<CompanyScreen companyId={KEY} />);
    await flush();
    const dock = view.container.querySelector('.act-dock')!;
    expect([...dock.children].map((node) => node.textContent)).toEqual(['Написать Роману', 'Хочу в компанию']);
    expect(dock.querySelector('.is-primary')!.textContent).toBe('Написать Роману');
    view.unmount();
  });

  it('B645: на 390 без знакомого в панели остаётся только «Хочу в компанию»', async () => {
    mobile = true;
    vi.mocked(api.getB640Company).mockResolvedValue(card());
    people([]);
    const view = mount(<CompanyScreen companyId={KEY} />);
    await flush();
    const dock = view.container.querySelector('.act-dock')!;
    expect([...dock.children].map((node) => node.textContent)).toEqual(['Хочу в компанию']);
    view.unmount();
  });

  it('B645: действия рендерятся и в шапке, и в панели — ширину переключает CSS, а не медиазапрос в JS', async () => {
    vi.mocked(api.getB640Company).mockResolvedValue(card());
    people([]);
    const view = mount(<CompanyScreen companyId={KEY} />);
    await flush();
    expect(view.container.querySelector('.co-head .co-head-acts .co-want')).not.toBeNull();
    expect(view.container.querySelector('.co-head .act-dock.only-mob .co-want')).not.toBeNull();
    view.unmount();
  });

  it('статус отклика вместо кнопки «Откликнуться»', async () => {
    vi.mocked(api.getB640Company).mockResolvedValue({ ...card(), applications: { 'cl-1': 'interview' } });
    people([]);
    const view = mount(<CompanyScreen companyId={KEY} />);
    await flush();
    expect(view.container.querySelector('.co-vrow .tag')!.textContent).toBe('Интервью');
    expect(view.container.querySelector('.co-vrow .btn')).toBeNull();
    expect(view.container.textContent).toContain('Знакомых в компании не нашли');
    view.unmount();
  });

  it('B645: знакомых нет, вакансия одна — «Откликнуться на вакансию» ведёт в её карточку', async () => {
    vi.mocked(api.getB640Company).mockResolvedValue(card());
    people([]);
    const view = mount(<CompanyScreen companyId={KEY} />);
    await flush();
    const action = view.container.querySelector<HTMLAnchorElement>('.co-ppl-next a.btn')!;
    expect(action.textContent).toBe('Откликнуться на вакансию');
    expect(action.getAttribute('href')).toBe('/app/vacancies/cl-1');
    expect(action.classList.contains('is-primary')).toBe(false);
    view.unmount();
  });

  it('B645: знакомых нет, вакансий несколько — переход к «Вакансиям по вашим ролям» на этой же карточке', async () => {
    vi.mocked(api.getB640Company).mockResolvedValue(card({}, [vacancy('cl-1', 'Руководитель'), vacancy('cl-2', 'Тимлид')]));
    people([]);
    const view = mount(<CompanyScreen companyId={KEY} />);
    await flush();
    const heading = view.container.querySelector<HTMLElement>('#co-vac')!;
    const scrolled = vi.fn();
    heading.scrollIntoView = scrolled;
    const action = view.container.querySelector<HTMLButtonElement>('.co-ppl-next button')!;
    expect(action.textContent).toBe('Откликнуться на вакансию');
    click(action);
    expect(scrolled).toHaveBeenCalled();
    expect(document.activeElement).toBe(heading);
    view.unmount();
  });

  it('B645: знакомых и вакансий нет — «Найти рекрутера» в «Контактах» по этой компании', async () => {
    vi.mocked(api.getB640Company).mockResolvedValue(card({}, []));
    people([]);
    const view = mount(<CompanyScreen companyId={KEY} />);
    await flush();
    const action = view.container.querySelector<HTMLAnchorElement>('.co-ppl-next a.btn')!;
    expect(action.textContent).toBe('Найти рекрутера');
    expect(action.getAttribute('href')).toBe('/app/profile/contacts?company=%D0%9B%D0%B0%D0%B4%D0%BE%D0%B3%D0%B0%20%D0%91%D0%B0%D0%BD%D0%BA');
    expect(view.container.textContent).toContain('Знакомых в компании не нашли');
    view.unmount();
  });

  it('«Хочу в компанию» → строка «В списке «Хочу»» с «Отменить»', async () => {
    vi.mocked(api.getB640Company).mockResolvedValue(card());
    people([]);
    const view = mount(<CompanyScreen companyId={KEY} />);
    await flush();
    click(view.container.querySelector('.co-want'));
    await flush();
    expect(api.setCandidateCompanyWant).toHaveBeenCalledWith(KEY);
    expect(view.container.querySelector('.co-wantline')!.textContent).toContain('В списке «Хочу»');
    click(view.container.querySelector('.co-wantline .row-act'));
    await flush();
    expect(api.removeCandidateCompanyWant).toHaveBeenCalledWith(KEY);
    expect(view.container.querySelector('.co-wantline')).toBeNull();
    view.unmount();
  });

  it('ключ названия из карточки вакансии идёт на сервер; вне подборки — путь назад', async () => {
    vi.mocked(api.getB640Company).mockRejectedValue(new CoachApiError('нет', 'company_not_in_selection', false));
    const view = mount(<CompanyScreen companyId="ladogabank" />);
    await flush();
    expect(api.getB640Company).toHaveBeenCalledWith('ladogabank');
    expect(view.container.textContent).toContain('Этой компании нет в вашей подборке');
    expect(view.container.querySelector('.vl-empty a')!.getAttribute('href')).toBe('/app/vacancies/companies');
    view.unmount();
  });

  it('ошибка чтения — «Повторить»', async () => {
    vi.mocked(api.getB640Company).mockRejectedValueOnce(new Error('net')).mockResolvedValue(card({}, []));
    people([]);
    const view = mount(<CompanyScreen companyId={KEY} />);
    await flush();
    click([...view.container.querySelectorAll('button')].find((button) => button.textContent === 'Повторить')!);
    await flush();
    expect(view.container.textContent).toContain('Вакансии по вашим ролям · 0');
    view.unmount();
  });
});
