// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CandidateCompanyDetails, CandidateCompanyRecruiter } from '../../../../../shared/candidateCompany';
import { CoachApiError } from '../../../coach/apiClient';
import { click, mount } from '../../kit/testDom';
import { CompanyScreen } from './CompanyScreen';

vi.mock('../../shell/ShellContext', () => ({
  useShell: () => ({ navigate: () => undefined }),
  useScreenChrome: () => undefined,
}));
vi.mock('../../../vacancies/candidateCompaniesApi', () => ({
  getCandidateCompanyDetails: vi.fn(),
  setCandidateCompanyWant: vi.fn(async () => undefined),
  removeCandidateCompanyWant: vi.fn(async () => undefined),
}));

const api = await import('../../../vacancies/candidateCompaniesApi');
const KEY = 'c'.repeat(24);

const recruiter = (id: string, fullName: string): CandidateCompanyRecruiter => ({
  id, companyKey: KEY, vacancyId: 'cl-1', fullName, roleTitle: 'технический рекрутер', email: null, emailStatus: 'unverified',
  phone: null, telegram: null, whatsapp: null, linkedinUrl: null, githubUrl: null, twitterUrl: null, source: 'vacancy',
  sourceLabel: 'hh.ru', sourceDate: '2026-11-11T09:00:00.000Z', isHypothesis: false,
});

function details(patch: Partial<CandidateCompanyDetails['company']> = {}, total = 1): CandidateCompanyDetails {
  const vacancies = [{ id: 'cl-1', title: 'Руководитель разработки', location: 'Москва', sourceName: 'hh.ru', sourceDate: '2026-11-11T09:00:00.000Z', href: '' }];
  return {
    company: {
      key: KEY, name: 'Ладога Банк', location: 'Москва', industry: 'Банки', vacancyCount: 1, contactsCount: null, contactsImportedAt: null,
      want: false, nextStep: null, hasRecruiter: true, recruiterSearchStatus: 'ready', sources: [{ name: 'hh.ru', observedAt: '2026-11-10T09:00:00.000Z' }],
      vacancies, recruiters: [recruiter('r1', 'Алина Громова'), recruiter('r2', 'Алина Громова')], ...patch,
    },
    vacancies, totalVacancies: total, vacancyOffset: 0, nextOffset: null,
  };
}

const flush = () => act(async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });
afterEach(() => vi.clearAllMocks());

describe('v10b: карточка компании', () => {
  it('шапка, вакансии со ссылками на карточку и отклик, человек один раз', async () => {
    vi.mocked(api.getCandidateCompanyDetails).mockResolvedValue(details());
    const view = mount(<CompanyScreen companyId={KEY} />);
    await flush();
    expect(view.container.querySelector('#co-name')!.textContent).toContain('Ладога Банк');
    expect(view.container.querySelector('.lead-text')!.textContent).toBe('Москва · Банки');
    expect(view.container.querySelector('.tip-bubble')!.textContent).toBe('Отрасль: Банки · Город: Москва · Источник: hh.ru, 10.11');
    const row = view.container.querySelector('.co-vrow')!;
    expect(row.querySelector('a.row-title')!.getAttribute('href')).toBe('/app/vacancies/cl-1');
    expect(row.querySelector('.row-sub')!.textContent).toBe('Москва · hh.ru · 11.11');
    expect(view.container.querySelectorAll('.co-person')).toHaveLength(1);
    expect(view.container.querySelector('.co-src')!.textContent).toBe('рекрутер вакансии на hh.ru, 11.11');
    view.unmount();
  });

  it('«Хочу в компанию» → строка «В списке «Хочу»» с «Отменить»', async () => {
    vi.mocked(api.getCandidateCompanyDetails).mockResolvedValue(details());
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

  it('компании нет в подборке или ключ чужой — путь назад к списку', async () => {
    vi.mocked(api.getCandidateCompanyDetails).mockRejectedValue(new CoachApiError('нет', 'company_not_in_selection', false));
    const view = mount(<CompanyScreen companyId={KEY} />);
    await flush();
    expect(view.container.querySelector('.vl-empty a')!.getAttribute('href')).toBe('/app/vacancies/companies');
    view.unmount();
    const other = mount(<CompanyScreen companyId="ladogabank" />);
    await flush();
    expect(api.getCandidateCompanyDetails).toHaveBeenCalledTimes(1);
    expect(other.container.textContent).toContain('Этой компании нет в вашей подборке');
    other.unmount();
  });

  it('ошибка чтения — «Повторить»', async () => {
    vi.mocked(api.getCandidateCompanyDetails).mockRejectedValueOnce(new Error('net')).mockResolvedValue(details({}, 0));
    const view = mount(<CompanyScreen companyId={KEY} />);
    await flush();
    click([...view.container.querySelectorAll('button')].find((button) => button.textContent === 'Повторить')!);
    await flush();
    expect(view.container.textContent).toContain('Вакансии по вашим ролям · 0');
    view.unmount();
  });
});
