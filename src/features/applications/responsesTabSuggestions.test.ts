import { describe, expect, it, vi } from 'vitest';
import type {
  CandidateCompanyOpportunity,
  CandidateCompanyWantPage,
} from '../../../shared/candidateCompany';
import type { ApplicationView } from './applicationsApi';
import {
  offersTabSuggestion,
  preparationTabSuggestion,
  wantTabSuggestion,
} from './responsesTabSuggestions';

const NOW = Date.parse('2026-10-08T09:00:00Z');

function application(patch: Record<string, unknown>): ApplicationView {
  return {
    id: 'app-1',
    stage: 'interview',
    vacancy: { title: 'VP Engineering', company: 'Арка Холдинг', companyHidden: false },
    nearestInterview: { id: 'i1', scheduledAt: '2026-10-10T11:00:00Z', prepStatus: 'none' },
    ...patch,
  } as unknown as ApplicationView;
}

function company(patch: Partial<CandidateCompanyOpportunity>): CandidateCompanyOpportunity {
  return {
    key: 'nordline',
    name: 'Нордлайн Финтех',
    location: null,
    industry: 'Финтех',
    vacancyCount: 7,
    contactsCount: 0,
    contactsImportedAt: null,
    want: true,
    wantStage: 'want',
    hasNewVacancies: false,
    nextStep: null,
    hasRecruiter: false,
    recruiterSearchStatus: 'idle',
    sources: [],
    vacancies: [],
    recruiters: [],
    ...patch,
  };
}

function wantPage(
  items: readonly CandidateCompanyOpportunity[],
  all = items.length,
): CandidateCompanyWantPage {
  return {
    items,
    total: items.length,
    offset: 0,
    limit: 20,
    counts: { all, new: 0, want: all, path: 0, waiting: 0 },
    industries: [],
  };
}

const prepActions = () => ({
  startMock: vi.fn(),
  openDebrief: vi.fn(),
  openStories: vi.fn(),
});

describe('«Подготовка» suggestion', () => {
  it('offers the mock interview for the nearest upcoming interview', () => {
    const actions = prepActions();
    const later = application({
      id: 'later',
      vacancy: { title: 'CTO', company: 'Вектор Банк', companyHidden: false },
      nearestInterview: { id: 'i2', scheduledAt: '2026-10-20T11:00:00Z' },
    });
    const suggestion = preparationTabSuggestion(
      { applications: [later, application({})], storyCount: 0, actions },
      NOW,
    );
    expect(suggestion?.title).toBe('Мок-интервью по Арка Холдинг');
    expect(suggestion?.acceptLabel).toBe('Начать');
    suggestion?.onAccept();
    expect(actions.startMock).toHaveBeenCalledWith('app-1');
  });

  it('prefers a dated interview over an undated one', () => {
    const undated = application({ id: 'undated', nearestInterview: null });
    const suggestion = preparationTabSuggestion(
      { applications: [undated, application({})], storyCount: 2, actions: prepActions() },
      NOW,
    );
    expect(suggestion?.id).toBe('mock-interview:app-1');
  });

  it('offers the debrief when every interview has passed', () => {
    const actions = prepActions();
    const passed = application({
      nearestInterview: { id: 'i1', scheduledAt: '2026-09-30T11:00:00Z' },
    });
    const suggestion = preparationTabSuggestion(
      { applications: [passed], storyCount: 1, actions },
      NOW,
    );
    expect(suggestion).toMatchObject({
      id: 'debrief:app-1',
      title: 'Дебриф по Арка Холдинг',
      detail: 'Интервью 30.09 прошло. Запишите, что спросили и что не получилось: 5 минут.',
      acceptLabel: 'Заполнить',
      dismissLabel: 'Не сейчас',
    });
    suggestion?.onAccept();
    expect(actions.openDebrief).toHaveBeenCalledWith('app-1');
  });

  it('without interviews and stories starts the first STAR story', () => {
    const actions = prepActions();
    const suggestion = preparationTabSuggestion(
      { applications: [application({ stage: 'applied' })], storyCount: 0, actions },
      NOW,
    );
    expect(suggestion?.title).toBe('STAR-историй пока нет');
    expect(suggestion?.detail).toMatch(/фактов профиля/);
    suggestion?.onAccept();
    expect(actions.openStories).toHaveBeenCalled();
  });

  it('without interviews counts the real stories', () => {
    const suggestion = preparationTabSuggestion(
      { applications: [], storyCount: 3, actions: prepActions() },
      NOW,
    );
    expect(suggestion?.title).toBe('Интервью пока не назначено');
    expect(suggestion?.detail).toMatch(/^3 STAR-истории готовы\./);
  });

  it('proposes nothing while stories are still loading', () => {
    expect(
      preparationTabSuggestion(
        { applications: [], storyCount: undefined, actions: prepActions() },
        NOW,
      ),
    ).toBeNull();
  });
});

describe('«Хочу в компанию» suggestion', () => {
  const wantActions = () => ({ openAdd: vi.fn(), findPath: vi.fn() });

  it('asks to add companies when «Хочу» is empty', () => {
    const actions = wantActions();
    const suggestion = wantTabSuggestion({
      page: wantPage([]),
      loading: false,
      error: '',
      actions,
    });
    expect(suggestion).toMatchObject({
      id: 'want:empty',
      title: 'В «Хочу» пока нет компаний',
      acceptLabel: 'Добавить компании',
    });
    suggestion?.onAccept();
    expect(actions.openAdd).toHaveBeenCalled();
  });

  it('names the company with new vacancies and no path yet', () => {
    const actions = wantActions();
    const fresh = company({
      key: 'sfera',
      name: 'Сфера Платежи',
      vacancyCount: 4,
      hasNewVacancies: true,
    });
    const suggestion = wantTabSuggestion({
      page: wantPage([company({ vacancyCount: 12 }), fresh]),
      loading: false,
      error: '',
      actions,
    });
    expect(suggestion?.title).toBe('Новые вакансии в Сфера Платежи');
    expect(suggestion?.detail).toBe('4 вакансии, есть новые за неделю. Пути к рекрутеру пока нет.');
    expect(suggestion?.acceptLabel).toBe('Найти путь');
    suggestion?.onAccept();
    expect(actions.findPath).toHaveBeenCalledWith(fresh);
  });

  it('falls back to the wanted company with the most vacancies and no path', () => {
    const suggestion = wantTabSuggestion({
      page: wantPage([
        company({ key: 'a', name: 'Бета Лабс', vacancyCount: 2 }),
        company({ key: 'b', name: 'Вега Банк', vacancyCount: 12 }),
        company({ key: 'c', name: 'Кедр', vacancyCount: 30, hasRecruiter: true }),
      ]),
      loading: false,
      error: '',
      actions: wantActions(),
    });
    expect(suggestion?.title).toBe('Путь в Вега Банк');
    expect(suggestion?.detail).toBe('12 вакансий, пути к рекрутеру пока нет.');
  });

  it('skips companies whose path search is already running', () => {
    const suggestion = wantTabSuggestion({
      page: wantPage([company({ recruiterSearchStatus: 'running', hasNewVacancies: true })]),
      loading: false,
      error: '',
      actions: wantActions(),
    });
    expect(suggestion).toBeNull();
  });

  it('proposes nothing while loading, on error or when a filter hides everything', () => {
    const base = { actions: wantActions() };
    expect(wantTabSuggestion({ ...base, page: undefined, loading: true, error: '' })).toBeNull();
    expect(
      wantTabSuggestion({ ...base, page: wantPage([]), loading: false, error: 'x' }),
    ).toBeNull();
    expect(
      wantTabSuggestion({ ...base, page: wantPage([], 5), loading: false, error: '' }),
    ).toBeNull();
  });
});

describe('«Офферы» suggestion', () => {
  const offerActions = () => ({ compare: vi.fn(), edit: vi.fn(), add: vi.fn() });

  function offer(
    id: string,
    companyName: string,
    terms: Record<string, unknown>,
    respondBy?: string,
  ) {
    return application({
      id,
      stage: 'offer',
      vacancy: { title: 'CTO', company: companyName, companyHidden: false },
      offer: { applicationId: id, terms, respondBy: respondBy ?? null },
    });
  }

  it('offers to compare two or more offers', () => {
    const actions = offerActions();
    const suggestion = offersTabSuggestion({
      offers: [
        offer('o1', 'Арка Холдинг', { baseSalary: 500000 }, '2026-10-15T00:00:00Z'),
        offer('o2', 'Вектор Банк', { baseSalary: 450000 }),
      ],
      loading: false,
      error: '',
      actions,
    });
    expect(suggestion?.title).toBe('Сравнить 2 оффера');
    expect(suggestion?.detail).toBe(
      'Арка Холдинг и Вектор Банк: оклад, бонус, акции и льготы рядом. Ответить Арка Холдинг до 15.10.',
    );
    suggestion?.onAccept();
    expect(actions.compare).toHaveBeenCalled();
  });

  it('with one offer lists the total comp parts that are not stated', () => {
    const actions = offerActions();
    const suggestion = offersTabSuggestion({
      offers: [offer('o1', 'Арка Холдинг', { baseSalary: 500000, bonus: 0 })],
      loading: false,
      error: '',
      actions,
    });
    expect(suggestion?.title).toBe('Что уточнить по офферу Арка Холдинг');
    expect(suggestion?.detail).toBe(
      'Не указаны акции и льготы (ДМС, релокация). Спросите о них до ответа: без них total comp неполный.',
    );
    expect(suggestion?.acceptLabel).toBe('Изменить условия');
    suggestion?.onAccept();
    expect(actions.edit).toHaveBeenCalledWith('o1');
  });

  it('with one complete offer suggests adding the next one', () => {
    const suggestion = offersTabSuggestion({
      offers: [
        offer('o1', 'Арка Холдинг', {
          baseSalary: 500000,
          bonus: 100000,
          equity: '0.1%',
          benefits: ['ДМС'],
        }),
      ],
      loading: false,
      error: '',
      actions: offerActions(),
    });
    expect(suggestion?.title).toBe('Оффер Арка Холдинг заполнен');
    expect(suggestion?.acceptLabel).toBe('Добавить оффер');
  });

  it('without offers says what to ask about total comp', () => {
    const actions = offerActions();
    const suggestion = offersTabSuggestion({ offers: [], loading: false, error: '', actions });
    expect(suggestion).toMatchObject({
      id: 'offers:empty',
      title: 'Что спросить о total comp',
      acceptLabel: 'Добавить оффер',
    });
    expect(suggestion?.detail).toMatch(/оклад, бонус, акции, ДМС и релокацию/);
    suggestion?.onAccept();
    expect(actions.add).toHaveBeenCalled();
  });

  it('proposes nothing while loading or on error', () => {
    const base = { offers: [], actions: offerActions() };
    expect(offersTabSuggestion({ ...base, loading: true, error: '' })).toBeNull();
    expect(offersTabSuggestion({ ...base, loading: false, error: 'x' })).toBeNull();
  });
});
