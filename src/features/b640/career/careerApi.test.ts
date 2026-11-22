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

import { addOwnRole, loadRoles, loadSkillStrip, readSkillGap, saveSearchRoles } from './careerApi';

const campaign = (roles: string[]) => ({
  roles: { value: roles, origin: 'explicit' },
  regions: { value: [], origin: 'default' },
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getRoleHypotheses.mockResolvedValue([]);
  api.getCheckedRoles.mockResolvedValue([]);
  api.getCandidateCampaign.mockResolvedValue(campaign(['Аналитик']));
  api.getCurrentRoleSkillAssessment.mockResolvedValue({
    state: 'ready',
    roleTitle: 'Аналитик',
    skills: [],
  });
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
    await expect(loadSkillStrip(new AbortController().signal)).resolves.toEqual({
      gap: 2,
      role: 'Аналитик',
    });
    expect(data.searchTitles).toEqual(['Аналитик']);
    expect(data.rows.map((row) => row.title)).toEqual(['Аналитик']);
  });

  it('полоса берёт первую готовую роль в порядке поиска, роли спрашивает разом (B645 s09)', async () => {
    api.getCandidateCampaign.mockResolvedValue(campaign(['VP', 'COO', 'IT Director']));
    const pending: Array<() => void> = [];
    api.getCurrentRoleSkillAssessment.mockImplementation(
      (role: string) =>
        new Promise((resolve) => {
          const answer =
            role === 'VP'
              ? { state: 'insufficient_requirements', roleTitle: 'VP', collecting: false }
              : { state: 'ready', roleTitle: role, skills: [{ name: 'X' }, { name: 'Y' }] };
          pending.push(() => resolve(answer));
        }),
    );
    api.getRoleSkillDemand.mockResolvedValue({ state: 'ready', roles: [] });
    const strip = loadSkillStrip(new AbortController().signal);
    await vi.waitFor(() => expect(api.getCurrentRoleSkillAssessment).toHaveBeenCalledTimes(3));
    // Все три запроса ушли до первого ответа; последний отвечает первым.
    [...pending].reverse().forEach((answer) => answer());
    await expect(strip).resolves.toEqual({ gap: 2, role: 'COO' });
  });

  it('таблица ролей не ждёт проверки навыков (B645 s09)', async () => {
    api.getCurrentRoleSkillAssessment.mockReturnValue(new Promise(() => undefined));
    api.getRoleSkillDemand.mockResolvedValue({ state: 'ready', roles: [] });
    const data = await loadRoles(new AbortController().signal);
    expect(data.rows.map((row) => row.title)).toEqual(['Аналитик']);
    expect(api.getCurrentRoleSkillAssessment).not.toHaveBeenCalled();
  });

  it('ни одна роль поиска не готова — полосы нет', async () => {
    api.getCurrentRoleSkillAssessment.mockResolvedValue({
      state: 'insufficient_requirements',
      roleTitle: 'Аналитик',
    });
    api.getRoleSkillDemand.mockResolvedValue({
      state: 'ready',
      roles: [{ roleTitle: 'Аналитик', skills: [{ name: 'SQL', inProfile: false }] }],
    });
    await expect(loadSkillStrip(new AbortController().signal)).resolves.toBeNull();
  });

  it('«Чего не хватает» без данных роли — первый навык из вакансий, которого нет в профиле (B645 s10)', async () => {
    api.getRoleSkillDemand.mockResolvedValue({
      state: 'ready',
      roles: [
        {
          roleTitle: 'Аналитик',
          skills: [
            { name: 'Excel', inProfile: true },
            { name: 'Работа с ВЭД', inProfile: false },
          ],
        },
      ],
    });
    const data = await loadRoles(new AbortController().signal);
    expect(data.rows[0]!.lacks).toBe('Работа с ВЭД');
  });

  it('требования не прочитались — полосы нет, экран читается', async () => {
    api.getRoleSkillDemand.mockRejectedValue(new Error('сбой'));
    const data = await loadRoles(new AbortController().signal);
    expect(data.rows).toHaveLength(1);
    await expect(loadSkillStrip(new AbortController().signal)).resolves.toEqual({
      gap: 0,
      role: 'Аналитик',
    });
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

describe('readSkillGap (строка навыков в «Вакансиях», s07)', () => {
  it('считает и ведёт туда же, что полоса «Роли»: первая роль с готовой проверкой', async () => {
    api.getCurrentRoleSkillAssessment.mockImplementation(async (role: string) =>
      role === 'VP'
        ? { state: 'insufficient_requirements', roleTitle: 'VP', collecting: false }
        : { state: 'ready', roleTitle: role, skills: [{ name: 'X' }, { name: 'Y' }, { name: 'Z' }] },
    );
    api.getRoleSkillDemand.mockResolvedValue({ state: 'ready', roles: [] });
    expect(await readSkillGap(['VP', 'COO'])).toEqual({ gap: 3, role: 'COO' });
  });

  it('ни одна роль не готова — строки нет', async () => {
    api.getCurrentRoleSkillAssessment.mockResolvedValue({ state: 'insufficient_requirements', roleTitle: 'VP' });
    api.getRoleSkillDemand.mockResolvedValue({ state: 'ready', roles: [] });
    expect(await readSkillGap(['VP'])).toEqual({ gap: 0, role: null });
  });
});
