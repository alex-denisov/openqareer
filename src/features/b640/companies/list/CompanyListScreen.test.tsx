// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { B640CompanyItem, B640CompanyPage } from '../../../../../shared/b640Companies';
type CandidateCompanyOpportunity = B640CompanyItem;
import { click, mount } from '../../kit/testDom';
import { CompanyListScreen } from './CompanyListScreen';

vi.mock('../../shell/ShellContext', () => ({
  useShell: () => ({ navigate: () => undefined }),
  useScreenChrome: () => undefined,
}));
vi.mock('../companiesApi', () => ({ getB640CompanyPage: vi.fn() }));
vi.mock('../../../vacancies/candidateCompaniesApi', () => ({
  setCandidateCompanyWant: vi.fn(async () => undefined),
  removeCandidateCompanyWant: vi.fn(async () => undefined),
}));

const api = { ...(await import('../../../vacancies/candidateCompaniesApi')), getCandidateCompanyPage: (await import('../companiesApi')).getB640CompanyPage };

function company(key: string, name: string, patch: Partial<CandidateCompanyOpportunity> = {}): CandidateCompanyOpportunity {
  return {
    key, name, location: 'Москва', industry: 'Банки', vacancyCount: 2, contactsCount: 0, contactsImportedAt: null,
    want: false, nextStep: null, hasRecruiter: false, recruiterSearchStatus: 'idle', sources: [], vacancies: [], recruiters: [],
    relocation: null, ...patch,
  };
}

function page(items: CandidateCompanyOpportunity[], total = items.length, relocation = 0): B640CompanyPage {
  return {
    items, total, offset: 0, limit: 20, sort: 'default', filter: 'all',
    filterCounts: { all: total, want: 1, contacts: null, recruiter: 4, relocation },
    linkedin: { status: 'disconnected', importedAt: null, contactsImported: false }, searchConsentGranted: false,
    relocation: false, city: null, cities: [{ name: 'Тула', count: 3 }],
  };
}

const flush = () => act(async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });

afterEach(() => vi.clearAllMocks());

describe('v10: компании подборки', () => {
  it('заголовок с числом, строки, фильтр без числа контактов скрыт', async () => {
    vi.mocked(api.getCandidateCompanyPage).mockResolvedValue(
      page([company('a'.repeat(24), 'Ладога Банк', { contactsCount: 2 }), company('b'.repeat(24), 'Гринкод', { want: true, vacancyCount: 1 })], 132),
    );
    const view = mount(<CompanyListScreen />);
    await flush();
    expect(view.container.querySelector('.co-h')!.textContent).toBe('132 компании в подборке');
    const rows = view.container.querySelectorAll('tr.co-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('.co-net')!.textContent).toBe('2 в сети');
    expect(rows[1]!.querySelector('.co-vac')!.textContent).toBe('1 вакансия');
    expect(rows[1]!.querySelector('.co-want')!.getAttribute('aria-pressed')).toBe('true');
    expect(rows[0]!.querySelector('a.co-nm')!.getAttribute('href')).toBe(`/app/vacancies/companies/${'a'.repeat(24)}`);
    const chips = [...view.container.querySelectorAll('.chip')].map((chip) => chip.textContent);
    expect(chips).toEqual(['Хочу · 1', 'Рекрутер известен · 4']);
    expect(view.container.querySelector('.vl-foot')!.textContent).toBe('Показать ещё 20 · осталось 130');
    view.unmount();
  });

  it('«Хочу в компанию» сохраняет отметку и меняет строку на месте', async () => {
    vi.mocked(api.getCandidateCompanyPage).mockResolvedValue(page([company('a'.repeat(24), 'Ладога Банк')]));
    const view = mount(<CompanyListScreen />);
    await flush();
    click(view.container.querySelector('.co-want'));
    await flush();
    expect(api.setCandidateCompanyWant).toHaveBeenCalledWith('a'.repeat(24));
    expect(view.container.querySelector('.co-want')!.getAttribute('aria-pressed')).toBe('true');
    expect(view.container.querySelector('.co-want')!.textContent).toBe('Хочу');
    view.unmount();
  });

  it('ошибка отметки — строка с «Повторить» на месте, повтор сохраняет', async () => {
    vi.mocked(api.getCandidateCompanyPage).mockResolvedValue(page([company('a'.repeat(24), 'Ладога Банк')]));
    vi.mocked(api.setCandidateCompanyWant).mockRejectedValueOnce(new Error('net'));
    const view = mount(<CompanyListScreen />);
    await flush();
    click(view.container.querySelector('.co-want'));
    await flush();
    expect(view.container.textContent).toContain('Не удалось сохранить отметку: Ладога Банк');
    click([...view.container.querySelectorAll('button')].find((button) => button.textContent === 'Повторить')!);
    await flush();
    expect(api.setCandidateCompanyWant).toHaveBeenCalledTimes(2);
    expect(view.container.querySelector('.co-want')!.getAttribute('aria-pressed')).toBe('true');
    view.unmount();
  });

  it('быстрый фильтр перечитывает список с сервера', async () => {
    vi.mocked(api.getCandidateCompanyPage).mockResolvedValue(page([company('a'.repeat(24), 'Ладога Банк')]));
    const view = mount(<CompanyListScreen />);
    await flush();
    click(view.container.querySelector('.chip'));
    await flush();
    expect(vi.mocked(api.getCandidateCompanyPage).mock.calls.at(-1)![0]).toMatchObject({ filter: 'want', offset: 0 });
    view.unmount();
  });

  it('ошибка загрузки — «Повторить» читает ещё раз', async () => {
    vi.mocked(api.getCandidateCompanyPage).mockRejectedValueOnce(new Error('net')).mockResolvedValue(page([]));
    const view = mount(<CompanyListScreen />);
    await flush();
    expect(view.container.textContent).toContain('Не удалось загрузить компании');
    click([...view.container.querySelectorAll('button')].find((button) => button.textContent === 'Повторить')!);
    await flush();
    expect(view.container.textContent).toContain('В подборке пока нет компаний');
    view.unmount();
  });

  it('релокация: чип с числом, снимаемый чип и пустое состояние v10g', async () => {
    vi.mocked(api.getCandidateCompanyPage)
      .mockResolvedValueOnce(page([company('a'.repeat(24), 'Ладога Банк')], 1, 9))
      .mockResolvedValue(page([], 0, 9));
    const view = mount(<CompanyListScreen />);
    await flush();
    const chip = [...view.container.querySelectorAll('.chip')].find((button) => button.textContent?.startsWith('Релокация'))!;
    expect(chip.textContent).toBe('Релокация · 9');
    click(chip);
    await flush();
    expect(api.getCandidateCompanyPage).toHaveBeenLastCalledWith(expect.objectContaining({ relocation: true, city: null }));
    expect(view.container.querySelector('.co-h')!.textContent).toBe('Компании с релокацией');
    expect(view.container.querySelector('.vt-chip')!.textContent).toBe('Релокация');
    expect(view.container.querySelector('.vl-empty a')!.textContent).toBe('Посмотреть удалённую работу');
    click(view.container.querySelector('.vt-reset'));
    await flush();
    expect(api.getCandidateCompanyPage).toHaveBeenLastCalledWith(expect.objectContaining({ relocation: false }));
    view.unmount();
  });
});
