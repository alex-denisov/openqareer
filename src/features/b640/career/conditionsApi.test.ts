import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getDecisionProfile: vi.fn(),
  putDecisionProfile: vi.fn(),
  listCandidateStopCompanies: vi.fn(),
  addCandidateStopCompany: vi.fn(),
  removeCandidateStopCompany: vi.fn(),
}));

vi.mock('../../coach/coachApi', () => ({
  getDecisionProfile: api.getDecisionProfile,
  putDecisionProfile: api.putDecisionProfile,
}));
vi.mock('../../automation/automationApi', () => ({
  listCandidateStopCompanies: api.listCandidateStopCompanies,
  addCandidateStopCompany: api.addCandidateStopCompany,
  removeCandidateStopCompany: api.removeCandidateStopCompany,
}));

import { loadConditions, saveConditions } from './conditionsApi';

const PROFILE = {
  citizenship: ['РФ'],
  searchLocations: ['Москва'],
  languages: [],
  workFormats: ['home_market' as const],
  salaryFloor: 400_000,
  salaryCurrency: 'RUB',
  hasFamily: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getDecisionProfile.mockResolvedValue(PROFILE);
  api.listCandidateStopCompanies.mockResolvedValue([{ company: 'Гринкод', origin: 'manual' }]);
  api.putDecisionProfile.mockResolvedValue(undefined);
  api.addCandidateStopCompany.mockResolvedValue(undefined);
  api.removeCandidateStopCompany.mockResolvedValue(undefined);
});

describe('условия поиска', () => {
  it('читает профиль ограничений и стоп-лист', async () => {
    const data = await loadConditions(new AbortController().signal);
    expect(data.conditions.geography.selected).toEqual(['Москва']);
    expect(data.conditions.salaryFrom.amountRubles).toBe(400_000);
    expect(data.conditions.format.hybrid).toBe(true);
    expect(data.conditions.stopList.map((company) => company.name)).toEqual(['Гринкод']);
  });

  it('зарплата: пишет профиль, гражданство остаётся, стоп-лист не трогает', async () => {
    const data = await loadConditions(new AbortController().signal);
    const after = {
      ...data.conditions,
      salaryFrom: { ...data.conditions.salaryFrom, amountRubles: 500_000 },
    };
    const saved = await saveConditions(data, after);
    expect(api.putDecisionProfile).toHaveBeenCalledTimes(1);
    const sent = api.putDecisionProfile.mock.calls[0]?.[0];
    expect(sent).toMatchObject({ salaryFloor: 500_000, citizenship: ['РФ'] });
    expect(api.addCandidateStopCompany).not.toHaveBeenCalled();
    expect(saved.conditions).toBe(after);
  });

  it('«Показывать вакансии без зарплаты» читается из профиля и сохраняется одно', async () => {
    api.getDecisionProfile.mockResolvedValue({ ...PROFILE, showWithoutSalary: false });
    const data = await loadConditions(new AbortController().signal);
    expect(data.conditions.salaryFrom.showWithoutSalary).toBe(false);
    const salaryFrom = { ...data.conditions.salaryFrom, showWithoutSalary: true };
    await saveConditions(data, { ...data.conditions, salaryFrom });
    expect(api.putDecisionProfile.mock.calls[0]?.[0]).toMatchObject({ salaryFloor: 400_000, showWithoutSalary: true });
  });

  it('стоп-лист: только добавленное и убранное, профиль не пишется', async () => {
    const data = await loadConditions(new AbortController().signal);
    const after = {
      ...data.conditions,
      stopList: [{ id: 'Ладога', name: 'Ладога', origin: 'manual' }],
    };
    await saveConditions(data, after);
    expect(api.addCandidateStopCompany).toHaveBeenCalledWith('Ладога');
    expect(api.removeCandidateStopCompany).toHaveBeenCalledWith('Гринкод');
    expect(api.putDecisionProfile).not.toHaveBeenCalled();
  });

  it('сбой записи — ошибка наверх', async () => {
    api.putDecisionProfile.mockRejectedValue(new Error('сбой'));
    const data = await loadConditions(new AbortController().signal);
    const after = { ...data.conditions, format: { office: true, hybrid: false, remote: false } };
    await expect(saveConditions(data, after)).rejects.toThrow('сбой');
  });
});
