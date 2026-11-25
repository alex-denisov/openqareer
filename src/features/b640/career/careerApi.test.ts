import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getRoleHypotheses: vi.fn(),
  getCandidateCampaign: vi.fn(),
  updateCampaignRoles: vi.fn(),
  getCheckedRoles: vi.fn(),
  getRoleSkillDemand: vi.fn(),
  getCurrentRoleSkillAssessment: vi.fn(),
  changeCareerRole: vi.fn(),
  readSelectionTotal: vi.fn(),
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
vi.mock('../vacancies/list/selectionCount', () => ({ readSelectionTotal: api.readSelectionTotal }));

import { clearEarlyReads } from '../../shell/earlyRead';
import {
  addOwnRole,
  loadRoles,
  loadSkillRoles,
  loadSkillStrip,
  readSkillGap,
  saveSearchRoles,
} from './careerApi';

const campaign = (roles: string[]) => ({
  roles: { value: roles, origin: 'explicit' },
  regions: { value: [], origin: 'default' },
});

beforeEach(() => {
  clearEarlyReads();
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
  it('B768: таблица ролей не ждёт числа вакансий выбора (на проде 3,6 с)', async () => {
    api.getRoleSkillDemand.mockResolvedValue({ state: 'ready', roles: [] });
    api.readSelectionTotal.mockReturnValue(new Promise(() => {}));
    const data = await loadRoles(new AbortController().signal);
    expect(data.searchTitles).toEqual(['Аналитик']);
    expect(api.readSelectionTotal).not.toHaveBeenCalled();
  });

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
    await expect(loadSkillStrip()).resolves.toEqual({
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
    const strip = loadSkillStrip();
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
    await expect(loadSkillStrip()).resolves.toBeNull();
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

  it('B747: «Чего не хватает» не берёт навык, который уже подтверждает опыт роли', async () => {
    api.getRoleHypotheses.mockResolvedValue([
      {
        id: 'r1',
        title: 'Аналитик',
        origin: 'model',
        reason: null,
        evidenceRefs: [],
        family: null,
        confirmation: {
          state: 'observed',
          sampleSize: 40,
          observedFrom: '2026-10-11',
          observedTo: '2026-11-10T09:00:00.000Z',
          sources: [{ source: 'hh', count: 40 }],
          repeatedRequirements: ['Excel', 'Операционная  эффективность'],
          matchedRequirementNames: ['Excel', 'Операционная  эффективность'],
        },
      },
    ]);
    api.getRoleSkillDemand.mockResolvedValue({
      state: 'ready',
      roles: [
        {
          roleTitle: 'Аналитик',
          skills: [
            { name: 'Операционная эффективность', inProfile: false },
            { name: 'BI', inProfile: false },
          ],
        },
      ],
    });
    const data = await loadRoles(new AbortController().signal);
    const row = data.rows.find((item) => item.title === 'Аналитик')!;
    expect(row.confirms).toContain('Excel');
    expect(row.lacks).toBe('BI');
  });

  it('требования не прочитались — полосы нет, экран читается', async () => {
    api.getRoleSkillDemand.mockRejectedValue(new Error('сбой'));
    const data = await loadRoles(new AbortController().signal);
    expect(data.rows).toHaveLength(1);
    await expect(loadSkillStrip()).resolves.toEqual({
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

  it('B645: проверка роли уже пройдена (result) — строка о пробелах из спроса и ссылка на эту роль', async () => {
    api.getCurrentRoleSkillAssessment.mockImplementation(async (role: string) =>
      role === 'COO'
        ? { state: 'result', run: { roleTitle: 'COO' } }
        : { state: role === 'VP' ? 'run' : 'insufficient_requirements', roleTitle: role },
    );
    api.getRoleSkillDemand.mockResolvedValue({
      state: 'ready',
      roles: [{ roleTitle: 'COO', skills: [{ name: 'P&L', inProfile: false }, { name: 'Lean', inProfile: false }, { name: 'ITIL', inProfile: true }] }],
    });
    expect(await readSkillGap(['VP', 'CTO', 'COO'])).toEqual({ gap: 2, role: 'COO' });
  });

  it('готовая проверка важнее пройденной; у пройденной без данных спроса строки нет', async () => {
    api.getCurrentRoleSkillAssessment.mockImplementation(async (role: string) =>
      role === 'COO' ? { state: 'result', run: { roleTitle: 'COO' } } : { state: 'ready', roleTitle: role, skills: [{ name: 'X' }] },
    );
    api.getRoleSkillDemand.mockResolvedValue({ state: 'ready', roles: [] });
    expect(await readSkillGap(['COO', 'CTO'])).toEqual({ gap: 1, role: 'CTO' });
    expect(await readSkillGap(['COO'])).toEqual({ gap: 0, role: 'COO' });
  });

  it('ни одна роль не готова — строки нет', async () => {
    api.getCurrentRoleSkillAssessment.mockResolvedValue({ state: 'insufficient_requirements', roleTitle: 'VP' });
    api.getRoleSkillDemand.mockResolvedValue({ state: 'ready', roles: [] });
    expect(await readSkillGap(['VP'])).toEqual({ gap: 0, role: null });
  });
});

describe('loadSkillRoles (выбор роли на C04)', () => {
  it('B726: на выбор только роли, проверку которых можно открыть; непрочитанная роль остаётся', async () => {
    api.getCandidateCampaign.mockResolvedValue(campaign(['CTO', 'COO', 'Head of IT', 'CIO', 'VP', 'Lead']));
    const answers: Record<string, unknown> = {
      CTO: { state: 'insufficient_requirements', roleTitle: 'CTO', collecting: false },
      COO: { state: 'result', run: {} },
      'Head of IT': { state: 'too_few_vacancies', roleTitle: 'Head of IT' },
      CIO: { state: 'ready', roleTitle: 'CIO', skills: [] },
      VP: { state: 'insufficient_requirements', roleTitle: 'VP', collecting: true },
    };
    api.getCurrentRoleSkillAssessment.mockImplementation((title: string) =>
      title in answers ? Promise.resolve(answers[title]) : Promise.reject(new Error('net')),
    );
    const roles = await loadSkillRoles(new AbortController().signal);
    expect(roles.checkable).toEqual(['COO', 'CIO', 'Lead']);
    expect(roles.ready).toBe('CIO');
    expect(api.getCurrentRoleSkillAssessment).toHaveBeenCalledTimes(6);
  });

  it('B767: два варианта одной роли с одним русским названием — на выбор одна роль, пройденная проверка первой', async () => {
    api.getCandidateCampaign.mockResolvedValue({
      ...campaign(['Head of Technical Support', 'CTO', 'Customer Support Director']),
      titlesRu: {
        'Head of Technical Support': 'Руководитель службы поддержки',
        'Customer Support Director': 'Руководитель службы поддержки',
        CTO: 'Технический директор (CTO)',
      },
    });
    const answers: Record<string, unknown> = {
      'Head of Technical Support': { state: 'ready', roleTitle: 'Head of Technical Support', skills: [] },
      CTO: { state: 'ready', roleTitle: 'CTO', skills: [] },
      'Customer Support Director': { state: 'result', run: {} },
    };
    api.getCurrentRoleSkillAssessment.mockImplementation((title: string) =>
      Promise.resolve(answers[title]),
    );
    const roles = await loadSkillRoles(new AbortController().signal);
    expect(roles.searchTitles).toEqual(['Customer Support Director', 'CTO']);
    expect(roles.checkable).toEqual(['Customer Support Director', 'CTO']);
    expect(roles.ready).toBe('CTO');
  });
});
