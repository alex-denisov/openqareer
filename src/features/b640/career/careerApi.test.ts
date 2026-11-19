import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getRoleHypotheses: vi.fn(),
  getCandidateCampaign: vi.fn(),
  updateCampaignRoles: vi.fn(),
  getCheckedRoles: vi.fn(),
  getRoleSkillDemand: vi.fn(),
  getCurrentRoleSkillAssessment: vi.fn(),
  changeCareerRole: vi.fn(),
}));

vi.mock('../../coach/coachApi', () => ({ getRoleHypotheses: api.getRoleHypotheses }));
vi.mock('../../coach/matchedVacancyApi', () => ({
  getCandidateCampaign: api.getCandidateCampaign,
  updateCampaignRoles: api.updateCampaignRoles,
}));
vi.mock('../../skills/roleSkillAssessmentApi', () => ({
  getCheckedRoles: api.getCheckedRoles,
  getCurrentRoleSkillAssessment: api.getCurrentRoleSkillAssessment,
}));
vi.mock('../../skills/roleSkillDemandApi', () => ({ getRoleSkillDemand: api.getRoleSkillDemand }));
vi.mock('../../career-map/careerRoleApi', () => ({ changeCareerRole: api.changeCareerRole }));

import { addOwnRole, loadRoles, saveSearchRoles } from './careerApi';

const campaign = (roles: string[]) => ({
  roles: { value: roles, origin: 'explicit' },
  regions: { value: [], origin: 'default' },
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getRoleHypotheses.mockResolvedValue([]);
  api.getCheckedRoles.mockResolvedValue([]);
  api.getCandidateCampaign.mockResolvedValue(campaign(['Аналитик']));
  api.getCurrentRoleSkillAssessment.mockResolvedValue({ state: 'ready', roleTitle: 'Аналитик', skills: [] });
});

describe('loadRoles', () => {
  it('пробелы считает по роли поиска', async () => {
    api.getRoleSkillDemand.mockResolvedValue({
      state: 'ready',
      roles: [
        { roleTitle: 'Другая', skills: [{ name: 'A', inProfile: false }] },
        {
          roleTitle: 'аналитик',
          skills: [
            { name: 'SQL', inProfile: false },
            { name: 'Excel', inProfile: true },
            { name: 'BI', inProfile: false },
          ],
        },
      ],
    });
    const data = await loadRoles(new AbortController().signal);
    expect(data.skillGap).toBe(2);
    expect(data.skillRole).toBe('Аналитик');
    expect(data.searchTitles).toEqual(['Аналитик']);
    expect(data.rows.map((row) => row.title)).toEqual(['Аналитик']);
  });

  it('полоса берёт первую роль поиска, у которой проверка готова (B645 s09)', async () => {
    api.getCandidateCampaign.mockResolvedValue(campaign(['VP', 'COO', 'IT Director']));
    api.getCurrentRoleSkillAssessment.mockImplementation(async (role: string) =>
      role === 'VP'
        ? { state: 'insufficient_requirements', roleTitle: 'VP', collecting: false }
        : { state: 'ready', roleTitle: role, skills: [{ name: 'X' }, { name: 'Y' }] },
    );
    api.getRoleSkillDemand.mockResolvedValue({ state: 'ready', roles: [] });
    const data = await loadRoles(new AbortController().signal);
    expect(data.skillRole).toBe('COO');
    expect(data.skillGap).toBe(2);
    expect(api.getCurrentRoleSkillAssessment).toHaveBeenCalledTimes(2);
  });

  it('ни одна роль поиска не готова — полосы нет', async () => {
    api.getCurrentRoleSkillAssessment.mockResolvedValue({ state: 'insufficient_requirements', roleTitle: 'Аналитик' });
    api.getRoleSkillDemand.mockResolvedValue({ state: 'ready', roles: [{ roleTitle: 'Аналитик', skills: [{ name: 'SQL', inProfile: false }] }] });
    const data = await loadRoles(new AbortController().signal);
    expect(data.skillGap).toBe(0);
    expect(data.skillRole).toBeNull();
  });

  it('«Чего не хватает» без данных роли — первый навык из вакансий, которого нет в профиле (B645 s10)', async () => {
    api.getRoleSkillDemand.mockResolvedValue({
      state: 'ready',
      roles: [{ roleTitle: 'Аналитик', skills: [{ name: 'Excel', inProfile: true }, { name: 'Работа с ВЭД', inProfile: false }] }],
    });
    const data = await loadRoles(new AbortController().signal);
    expect(data.rows[0]!.lacks).toBe('Работа с ВЭД');
  });

  it('требования не прочитались — полосы нет, экран читается', async () => {
    api.getRoleSkillDemand.mockRejectedValue(new Error('сбой'));
    const data = await loadRoles(new AbortController().signal);
    expect(data.skillGap).toBe(0);
  });

  it('роли не прочитались — ошибка экрана', async () => {
    api.getRoleHypotheses.mockRejectedValue(new Error('сбой'));
    await expect(loadRoles(new AbortController().signal)).rejects.toThrow('сбой');
  });
});

describe('сохранение', () => {
  it('роли поиска уходят в кампанию целиком', async () => {
    const current = campaign(['Аналитик']);
    api.updateCampaignRoles.mockResolvedValue(campaign(['A', 'B']));
    await expect(saveSearchRoles(['A', 'B'], current as never)).resolves.toEqual(['A', 'B']);
    expect(api.updateCampaignRoles).toHaveBeenCalledWith(['A', 'B'], current);
  });

  it('своя роль добавляется в роли поиска', async () => {
    api.changeCareerRole.mockResolvedValue(undefined);
    await addOwnRole('Архитектор');
    expect(api.changeCareerRole).toHaveBeenCalledWith('add', 'Архитектор');
  });
});
